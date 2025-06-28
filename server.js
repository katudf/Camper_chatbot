const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const rateLimit = require('express-rate-limit');
const cors = require('cors');
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
// --- ★★★ 修正点：プロキシを信頼する設定を追加 ★★★ ---
// Renderのようなホスティング環境では、この設定が必要
app.set('trust proxy', 1);
// --- ★★★ 修正ここまで ★★★ ---

// --- ★★★ 修正点：CORS設定をapp初期化の後に移動 ★★★ ---
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://kpi-campingcar.com',
    'https://katudf.github.io',
    'https://camper-chatbot.onrender.com',
    'https://camper-chatbot-loss.web.app' // ★★★ エラーに出ていたURLを追加！ ★★★
];
const corsOptions = {
  origin: function (origin, callback) {
    // 許可リストに含まれていればCORSを許可
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger(LOG_LEVELS.ERROR, 'CORSによってブロックされたリクエスト', { origin: origin });
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());
// --- ★★★ 修正ここまで ★★★ ---

// --- Firebase Admin SDKの初期化 ---
try {
    // Renderの環境変数から直接JSON文字列を読み込むことを想定
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountString) {
        throw new Error('環境変数 FIREBASE_SERVICE_ACCOUNT_KEY が設定されていません。');
    }
    const serviceAccount = JSON.parse(serviceAccountString);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    logger(LOG_LEVELS.INFO, "Firebase Admin SDK has been initialized successfully.");
} catch (error) {
    logger(LOG_LEVELS.ERROR, 'Firebase Admin SDKの初期化に失敗しました。', { error: error.message });
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

// ★★★★★ プロンプトバージョン管理API追加 ★★★★★
/**
 * プロンプトの新バージョンを保存し、アクティブバージョンを更新するAPI
 * POST /api/save_prompt_version
 * body: { promptData: {...}, editor: '編集者名' }
 */
app.post('/api/save_prompt_version', async (req, res) => {
    console.log('save_prompt_version headers:', req.headers);
    console.log('save_prompt_version req.body:', req.body); // 受信内容を確認
    try {
        const db = admin.firestore();
        const { promptData, editor, comment } = req.body;
        if (!promptData) return res.status(400).json({ error: 'promptDataがありません' });
        // 最新バージョン番号を取得
        const versionsSnap = await db.collection('prompt_versions').orderBy('version', 'desc').limit(1).get();
        let newVersion = 1;
        if (!versionsSnap.empty) {
            newVersion = (versionsSnap.docs[0].data().version || 0) + 1;
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        // 新バージョンを保存
        const versionDoc = await db.collection('prompt_versions').add({
            ...promptData,
            version: newVersion,
            createdAt: now,
            editor: editor || 'unknown',
            comment: comment || ''
        });
        // promptsコレクションにアクティブバージョンIDを保存
        await db.collection('prompts').doc('active').set({
            activeVersionId: versionDoc.id,
            updatedAt: now
        });
        await loadAndBuildPrompt(); // 追加: 保存後にプロンプト再読込
        logger(LOG_LEVELS.INFO, `新しいプロンプトバージョン(v${newVersion})を保存しアクティブ化しました。`, { version: newVersion });
        res.json({ success: true, version: newVersion, versionId: versionDoc.id });
    } catch (error) {
        logger(LOG_LEVELS.ERROR, '/api/save_prompt_version でエラー', { error: error.message });
        res.status(500).json({ error: '保存に失敗しました' });
    }
});

/**
 * バージョン履歴一覧取得API
 * GET /api/prompt_versions
 */
app.get('/api/prompt_versions', async (req, res) => {
    try {
        const db = admin.firestore();
        const snap = await db.collection('prompt_versions').orderBy('version', 'desc').get();
        const versions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json({ versions });
    } catch (error) {
        logger(LOG_LEVELS.ERROR, '/api/prompt_versions でエラー', { error: error.message });
        res.status(500).json({ error: '取得に失敗しました' });
    }
});

/**
 * 指定バージョンをアクティブ化（ロールバック）するAPI
 * POST /api/activate_prompt_version
 * body: { versionId: '...' }
 */
app.post('/api/activate_prompt_version', async (req, res) => {
    try {
        const db = admin.firestore();
        const { versionId } = req.body;
        if (!versionId) return res.status(400).json({ error: 'versionIdがありません' });
        // バージョン存在確認
        const versionDoc = await db.collection('prompt_versions').doc(versionId).get();
        if (!versionDoc.exists) return res.status(404).json({ error: '指定バージョンが存在しません' });
        // promptsコレクションのactiveVersionIdを更新
        await db.collection('prompts').doc('active').set({
            activeVersionId: versionId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await loadAndBuildPrompt(); // 追加: アクティブ化後にプロンプト再読込
        logger(LOG_LEVELS.INFO, `プロンプトバージョン(${versionId})をアクティブ化しました。`);
        res.json({ success: true });
    } catch (error) {
        logger(LOG_LEVELS.ERROR, '/api/activate_prompt_version でエラー', { error: error.message });
        res.status(500).json({ error: 'アクティブ化に失敗しました' });
    }
});
// ★★★★★ バージョン管理APIここまで ★★★★★

// ★★★★★ 修正点 ★★★★★
async function loadAndBuildPrompt() {
    logger(LOG_LEVELS.INFO, 'Firestoreからアクティブなプロンプトバージョンを読み込んでいます...');
    try {
        const db = admin.firestore();
        // promptsコレクションからアクティブバージョンIDを取得
        const activeDoc = await db.collection('prompts').doc('active').get();
        if (!activeDoc.exists || !activeDoc.data().activeVersionId) {
            logger(LOG_LEVELS.ERROR, 'アクティブなプロンプトバージョンが設定されていません。');
            // process.exit(1) を削除し、サーバーを落とさずエラー状態を維持
            promptTemplate = '';
            return;
        }
        const versionId = activeDoc.data().activeVersionId;
        // prompt_versionsから該当バージョンのデータを取得
        const versionDoc = await db.collection('prompt_versions').doc(versionId).get();
        if (!versionDoc.exists) {
            logger(LOG_LEVELS.ERROR, '指定されたプロンプトバージョンが見つかりません。', { versionId });
            // process.exit(1) を削除し、サーバーを落とさずエラー状態を維持
            promptTemplate = '';
            return;
        }
        const p = versionDoc.data();
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
- **LINE**: [${p.links?.link_line || ''}](${p.links?.link_line || ''})
- **Carstay**: [${p.links?.link_carstay || ''}](${p.links?.link_carstay || ''})
- **その他1**: [${p.links?.link_other1 || ''}](${p.links?.link_other1 || ''})
- **その他2**: [${p.links?.link_other2 || ''}](${p.links?.link_other2 || ''})
- **その他3**: [${p.links?.link_other3 || ''}](${p.links?.link_other3 || ''})
- **その他4**: [${p.links?.link_other4 || ''}](${p.links?.link_other4 || ''})
- **その他5**: [${p.links?.link_other5 || ''}](${p.links?.link_other5 || ''})\n\n`;
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
             finalPrompt += `#### 各種規約\n`;
             finalPrompt += `- **貸渡約款**: ${p.policies.termsContent || ''}`;
             if (p.links?.link_terms) {
                 finalPrompt += `\n  - [貸渡約款ページ](${p.links.link_terms})`;
             }
             finalPrompt += `\n- **プライバシーポリシー**: ${p.policies.privacyPolicyContent || ''}`;
             if (p.links?.link_privacy) {
                 finalPrompt += `\n  - [プライバシーポリシーページ](${p.links.link_privacy})`;
             }
             finalPrompt += `\n\n`;
        }

        if (p.bot_control) {
            finalPrompt += `### AIの挙動制御
- **不適切な質問への対応**: ${p.bot_control.inappropriateQuestionResponse || ''}
- **ネガティブプロンプト (禁止事項)**: ${p.bot_control.negativePrompt || ''}\n`;
        }

        // --- その他 ---
        if (p.other && p.other.otherInfo) {
            finalPrompt += `\n### その他\n${p.other.otherInfo}\n`;
        }

        promptTemplate = finalPrompt;
        logger(LOG_LEVELS.INFO, 'アクティブなプロンプトバージョンを正常に読み込み、組み立てました。');
    } catch (error) {
        logger(LOG_LEVELS.ERROR, 'アクティブなプロンプトバージョン読み込み・組み立て中にエラーが発生しました:', { error: error.message, stack: error.stack });
        // process.exit(1) を削除し、サーバーを落とさずエラー状態を維持
        promptTemplate = '';
    }
}
// ★★★★★ 修正ここまで ★★★★★


// レートリミット設定
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { reply: 'リクエストが多すぎます。少し時間をおいてから再度お試しください。', source: 'system' }
});

app.use('/api/chat', apiLimiter);
app.use('/prompt-editor', express.static(path.join(__dirname, 'prompt-editor')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));
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

// ★★★★★ アクティブプロンプトバージョン取得API ★★★★★
/**
 * アクティブなプロンプトバージョンのデータを返すAPI
 * GET /api/get_active_prompt_version
 * return: { activeVersionId, promptData, version, createdAt, editor }
 */
app.get('/api/get_active_prompt_version', async (req, res) => {
    try {
        const db = admin.firestore();
        const activeDoc = await db.collection('prompts').doc('active').get();
        if (!activeDoc.exists || !activeDoc.data().activeVersionId) {
            return res.status(404).json({ error: 'アクティブバージョンが設定されていません' });
        }
        const activeVersionId = activeDoc.data().activeVersionId;
        const versionDoc = await db.collection('prompt_versions').doc(activeVersionId).get();
        if (!versionDoc.exists) {
            return res.status(404).json({ error: 'アクティブバージョンのデータが見つかりません' });
        }
        const data = versionDoc.data();
        res.json({
            activeVersionId,
            promptData: {
                bot_personality: data.bot_personality || {},
                bot_control: data.bot_control || {},
                company_info: data.company_info || {},
                qna: data.qna || {},
                links: data.links || {},
                vehicle_zil: data.vehicle_zil || {},
                vehicle_crea: data.vehicle_crea || {},
                vehicle_common: data.vehicle_common || {},
                pricing: data.pricing || {},
                procedures: data.procedures || {},
                policies: data.policies || {},
                preparation: data.preparation || {},
                recommendations: data.recommendations || {}
            },
            version: data.version,
            createdAt: data.createdAt,
            editor: data.editor
        });
    } catch (error) {
        logger(LOG_LEVELS.ERROR, '/api/get_active_prompt_version でエラー', { error: error.message });
        res.status(500).json({ error: '取得に失敗しました' });
    }
});
// ★★★★★ ここまで追加 ★★★★★

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-menu.html'));
});

// server.js に追加

/**
 * サーバーのヘルスチェック用エンドポイント
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  // サーバーが正常に動作していることを示すステータス200とJSONを返す
  res.status(200).json({ status: 'ok' });
});

async function startServer() {
    await loadAndBuildPrompt();

    app.listen(port, () => {
        logger(LOG_LEVELS.INFO, `サーバーが http://localhost:${port} で起動しました`);
    }).on('error', (err) => {
        logger(LOG_LEVELS.ERROR, 'サーバー起動時に致命的なエラーが発生しました:', { error: err.message });
        process.exit(1);
    });
}

startServer();
