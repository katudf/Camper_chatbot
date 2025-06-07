const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const rateLimit = require('express-rate-limit');

// Firebase Admin SDK をインポート
const admin = require('firebase-admin');

// --- 簡易ロガー関数の導入 ---
const LOG_LEVELS = { INFO: 'INFO', ERROR: 'ERROR', DEBUG: 'DEBUG', WARN: 'WARN' };
function logger(level, message, details) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    if (details && typeof details === 'object' && Object.keys(details).length > 0) {
        try {
            logMessage += ` - Details: ${JSON.stringify(details, null, 2)}`;
        } catch (e) {
            logMessage += ` - Details: (Failed to stringify details: ${e.message})`;
        }
    }
    console.log(logMessage);
}
// --- ロガー関数の導入ここまで ---

const app = express();
const port = process.env.PORT || 3000;

// --- Firebase Admin SDKの初期化 ---
try {
    const serviceAccount = require('./service-account-key.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    // dbインスタンスは各関数内で admin.firestore() を呼び出して取得
    logger(LOG_LEVELS.INFO, "Firebase Admin SDK has been initialized successfully.");
} catch (error) {
    logger(LOG_LEVELS.ERROR, 'Firebase Admin SDKの初期化に失敗しました。service-account-key.jsonファイルを確認してください。', { error: error.message });
    process.exit(1);
}
// --- Firebase初期化ここまで ---


const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    logger(LOG_LEVELS.ERROR, "環境変数 GEMINI_API_KEY が設定されていません。");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(API_KEY);

let promptTemplate = '';

// ★★★★★ 修正点 ★★★★★
async function loadAndBuildPrompt() {
    logger(LOG_LEVELS.INFO, 'Firestoreからプロンプトデータを読み込んでいます...');
    try {
        const db = admin.firestore(); // Admin SDKのFirestoreインスタンスを使用
        const promptsCollectionRef = db.collection('prompts');
        const querySnapshot = await promptsCollectionRef.get();
        
        const p = {};
        querySnapshot.forEach(doc => { p[doc.id] = doc.data(); });

        if (Object.keys(p).length === 0) {
            logger(LOG_LEVELS.ERROR, 'Firestoreにプロンプトデータが見つかりません。');
            process.exit(1);
        }

        // --- プロンプト組み立てロジック ---
        let finalPrompt = "";
        
        // --- 基本設定 ---
        if (p.bot_personality) {
            finalPrompt += `${p.bot_personality.roleDescription || ''}\n\n`;
            finalPrompt += `### コミュニケーション原則\n${p.bot_personality.communicationPrinciples || ''}\n\n`;
        }

        // --- Q&A知識ベース ---
        if (p.qna && p.qna.qnaContent) {
            finalPrompt += `### よくある質問と回答 (Q&A)\n以下の質問には、このセクションの回答を最優先で、できるだけ忠実に返してください。\n`;
            const qnaPairs = p.qna.qnaContent.split('\n').filter(line => line.includes(':::'));
            qnaPairs.forEach(pair => {
                const [question, answer] = pair.split(':::');
                if (question && answer) {
                    finalPrompt += `- 質問:「${question.trim()}」 -> 回答:「${answer.trim()}」\n`;
                }
            });
            finalPrompt += `\n`;
        }

        // --- 詳細情報知識ベース ---
        finalPrompt += `---
### 詳細情報知識ベース\n以下の情報を参考にして、上記のQ&Aにない質問に回答してください。\n\n`;

        if (p.company_info) {
            finalPrompt += `#### 会社情報
- **会社名**: ${p.company_info.companyName || ''}
- **所在地**: ${p.company_info.location || ''}
- **電話番号**: ${p.company_info.phone || ''}
- **営業時間**: ${p.company_info.businessHours || ''}
- **定休日**: ${p.company_info.holidays || ''}
- **アピールポイント**: ${p.company_info.appealPoints || ''}
- **最新のキャンペーン情報**: ${p.company_info.campaignInfo || '現在、特別なキャンペーン情報はありません。'}
- **お知らせ・イベント情報**: 詳細は[お知らせページ](${p.links?.link_news || ''})をご覧ください。
- **Instagram**: [${p.links?.link_instagram || ''}](${p.links?.link_instagram || ''})
- **LINE**: [${p.links?.link_line || ''}](${p.links?.link_line || ''})\n\n`;
        }
        
        if (p.vehicle_zil && p.vehicle_crea) {
             finalPrompt += `#### 車両情報
- **ZIL (ジル) 520**:
  - **特徴**: ${p.vehicle_zil.vehicle_zil_features || ''}
  - **詳細ページ**: [${p.links?.link_zil || ''}](${p.links?.link_zil || ''})
- **CREA (クレア) 5.3X**:
  - **特徴**: ${p.vehicle_crea.vehicle_crea_features || ''}
  - **詳細ページ**: [${p.links?.link_crea || ''}](${p.links?.link_crea || ''})\n`;
        }
        if (p.vehicle_common) {
            finalPrompt += `- **共通設備**: ${p.vehicle_common.commonEquipment || ''}\n`;
            finalPrompt += `- **その他設備（電気系統など）**: ${p.vehicle_common.otherEquipment || ''}\n\n`;
        }

        if (p.preparation) {
            finalPrompt += `#### 持ち物・準備
- **必須アイテム**: ${p.preparation.essentialItems || ''}
- **あると便利なアイテム**: ${p.preparation.convenientItems || ''}\n\n`;
        }

        if (p.recommendations) {
            finalPrompt += `#### おすすめ情報
- **車中泊スポット案内**: ${p.recommendations.overnightSpots || ''}\n\n`;
        }
        
        if (p.pricing) {
            finalPrompt += `#### 料金プラン (すべて税込)
- **注意書き**: ${p.pricing.pricing_notes || ''}
- **支払い方法**: ${p.pricing.paymentMethods || ''}
- **長期割引**:\n${p.pricing.longTermDiscounts || ''}\n
- **キャンセル料**:\n${p.pricing.cancellationPolicy || ''}
- **料金詳細**: 詳しくは[料金案内ページ](${p.links?.link_pricing || ''})をご覧ください。\n\n`;
        }

        if (p.procedures) {
            finalPrompt += `#### 手続き・ルール
- **貸出当日の流れ**: ${p.procedures.checkoutFlow || ''} 詳細は[貸出の流れページ](${p.links?.link_checkoutFlow || ''})へ。
- **返却時の流れ**: ${p.procedures.checkinFlow || ''} 詳細は[返却の流れページ](${p.links?.link_checkinFlow || ''})へ。
- **使用マナー**: ${p.procedures.usageManners || ''}
- **禁止事項**: ${p.procedures.prohibitedItems || ''}
- **事故対応**: ${p.procedures.accidentResponse || ''} 詳細は[事故対応ページ](${p.links?.link_accidentResponse || ''})へ。\n\n`;
        }
        
        if (p.policies) {
             finalPrompt += `#### 各種規約
- **貸渡約款**: ${p.policies.termsContent || ''}\n
- **プライバシーポリシー**: ${p.policies.privacyPolicyContent || ''}\n\n`;
        }

        if (p.bot_control) {
            finalPrompt += `### AIの挙動制御
- **不適切な質問への対応**: ${p.bot_control.inappropriateQuestionResponse || ''}
- **ネガティブプロンプト (禁止事項)**: ${p.bot_control.negativePrompt || ''}\n`;
        }

        promptTemplate = finalPrompt;
        logger(LOG_LEVELS.INFO, '構造化されたプロンプトをFirestoreから正常に読み込み、組み立てました。');

    } catch (error) {
        logger(LOG_LEVELS.ERROR, 'Firestoreからのプロンプト読み込み・組み立て中にエラーが発生しました:', { error: error.message, stack: error.stack });
        process.exit(1);
    }
}
// ★★★★★ 修正ここまで ★★★★★


// レートリミット設定
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { reply: 'リクエストが多すぎます。少し時間をおいてから再度お試しください。', source: 'system' }
});

app.use(express.json());
app.use('/api/chat', apiLimiter);
app.use('/editor', express.static(path.join(__dirname, 'prompt-editor')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ★★★★★ 新しいAPIエンドポイントを追加 ★★★★★
/**
 * 会話履歴をCSV形式でエクスポートするAPI
 */
app.get('/api/export_conversations', async (req, res) => {
    logger(LOG_LEVELS.INFO, "--- /api/export_conversations リクエスト受信 ---");
    try {
        const db = admin.firestore();
        const conversationsRef = db.collection('conversations');
        // タイムスタンプの降順（新しいものから）でデータを取得
        const snapshot = await conversationsRef.orderBy('timestamp', 'desc').get();

        if (snapshot.empty) {
            logger(LOG_LEVELS.WARN, "エクスポートする会話ログがありませんでした。");
            return res.status(404).send("エクスポートするデータがありません。");
        }

        let csvData = '"Timestamp","UserID","Question","Answer"\n'; // CSVヘッダー

        snapshot.forEach(doc => {
            const data = doc.data();
            const timestamp = data.timestamp ? data.timestamp.toDate().toLocaleString('ja-JP') : 'N/A';
            const userId = `"${data.userId || ''}"`;
            // " や , を含む可能性のあるフィールドをエスケープ
            const question = `"${(data.question || '').replace(/"/g, '""')}"`;
            const answer = `"${(data.answer || '').replace(/"/g, '""')}"`;
            
            csvData += `${timestamp},${userId},${question},${answer}\n`;
        });
        
        // CSVファイルとしてダウンロードさせるためのヘッダーを設定
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="conversation_history_${Date.now()}.csv"`);
        res.send(Buffer.from('\uFEFF' + csvData)); // UTF-8 BOM付きで文字化けを防ぐ

        logger(LOG_LEVELS.INFO, "会話ログのCSVエクスポートに成功しました。");

    } catch (error) {
        logger(LOG_LEVELS.ERROR, '/api/export_conversations でエラーが発生しました:', { error: error.message, stack: error.stack });
        res.status(500).send("エクスポート中にサーバーエラーが発生しました。");
    }
});
// ★★★★★ API追加ここまで ★★★★★

const userChatSessions = {};

app.post('/api/chat', async (req, res) => {
    // (中略... quota管理は現在ないため、ロジックはシンプルに)
    if (!promptTemplate) {
        logger(LOG_LEVELS.ERROR, 'プロンプトが読み込まれていないため、応答できません。');
        return res.status(500).json({ reply: 'サーバー設定エラー: プロンプトがありません。', source: 'system' });
    }

    try {
        const userMessage = req.body.message;
        const userId = req.body.userId || 'defaultUser';

        if (!userMessage) {
            return res.status(400).json({ reply: 'メッセージが空です。', source: 'system' });
        }
        
        if (!userChatSessions[userId]) {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction: promptTemplate });
            userChatSessions[userId] = model.startChat({ history: [] });
        }

        const chat = userChatSessions[userId];
        const result = await chat.sendMessage(userMessage);
        const replyMessage = result.response.text();

        // Firestoreへの保存 (Admin SDKを使用)
        try {
            const db = admin.firestore();
            const conversationLog = {
                userId: userId,
                question: userMessage,
                answer: replyMessage,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };
            await db.collection('conversations').add(conversationLog);
        } catch (dbError) {
            logger(LOG_LEVELS.ERROR, 'Firestoreへの会話ログ保存中にエラーが発生しました。', { error: dbError.message });
        }

        res.json({ reply: replyMessage, source: 'ai' });

    } catch (error) {
        logger(LOG_LEVELS.ERROR, '/api/chat でエラーが発生しました:', { error: error.message });
        res.status(500).json({ reply: 'AIとの通信中にエラーが発生しました。', source: 'system' });
    }
});

async function startServer() {
    await loadAndBuildPrompt();

    app.listen(port, () => {
        logger(LOG_LEVELS.INFO, `サーバーが http://localhost:${port} で起動しました`);
        logger(LOG_LEVELS.INFO, `チャットボットは http://localhost:${port} で利用できます。`);
        logger(LOG_LEVELS.INFO, `プロンプトエディタは http://localhost:${port}/editor/editor.html で利用できます。`);
    }).on('error', (err) => {
        logger(LOG_LEVELS.ERROR, 'サーバー起動時に致命的なエラーが発生しました:', { error: err.message });
        process.exit(1);
    });
}

startServer();
