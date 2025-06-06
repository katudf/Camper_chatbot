// 1. Expressを読み込む
const express = require('express');
const path = require('path');
// ★★★ test-gemini.js と同じSDK (@google/generative-ai) を使用する ★★★
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const fs = require('fs');

// --- 簡易ロガー関数の導入 ---
const LOG_LEVELS = {
    INFO: 'INFO',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG',
    WARN: 'WARN'
};

/**
 * ログを出力する関数
 * @param {string} level ログレベル (INFO, ERROR, DEBUG, WARN)
 * @param {string} message ログメッセージ
 * @param {object} [details] オプション: 詳細情報オブジェクト
 */
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
    console.log(logMessage); // 実際のログ出力は console.log を使用
}
// --- ロガー関数の導入ここまで ---

logger(LOG_LEVELS.INFO, "--- Requiring '@google/generative-ai' module ---");

const app = express();
let port = 3000;
let dailyRequestLimit = 500;
let modelName = "gemini-1.5-flash-latest";
const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');

try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
        const configData = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
        const parsedConfig = JSON.parse(configData);
        port = parsedConfig.serverSettings?.port || port;
        dailyRequestLimit = parsedConfig.apiSettings?.dailyRequestLimit || dailyRequestLimit;
        modelName = parsedConfig.apiSettings?.modelName || modelName;
        logger(LOG_LEVELS.INFO, `設定ファイルを読み込みました: ポート=${port}, 日次上限=${dailyRequestLimit}, モデル名=${modelName}`);
    } else {
        logger(LOG_LEVELS.WARN, `設定ファイル (${CONFIG_FILE_PATH}) が見つかりません。デフォルト設定を使用します。`);
    }
} catch (error) {
    logger(LOG_LEVELS.ERROR, '設定ファイルの読み込みまたは解析に失敗しました。デフォルト設定を使用します。', { error: error.message });
}

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    logger(LOG_LEVELS.ERROR, "環境変数 GEMINI_API_KEY が設定されていません。");
    process.exit(1);
}

logger(LOG_LEVELS.INFO, "--- Initializing GoogleGenerativeAI with API_KEY ---");
const genAI = new GoogleGenerativeAI(API_KEY);
logger(LOG_LEVELS.INFO, "[SERVER.JS] genAI instance created.");

logger(LOG_LEVELS.INFO, "[SERVER.JS] Checking for genAI.getGenerativeModel method...");
if (genAI && typeof genAI.getGenerativeModel === 'function') {
    logger(LOG_LEVELS.INFO, "[SERVER.JS] genAI.getGenerativeModel IS a function. SDK initialized correctly!");
} else {
    logger(LOG_LEVELS.ERROR, "[SERVER.JS] genAI.getGenerativeModel IS NOT a function.");
    if (genAI) {
        logger(LOG_LEVELS.ERROR, "[SERVER.JS] Available methods/props on genAI:", Object.keys(genAI));
    }
    process.exit(1);
}

let faqData = [];
try {
    faqData = JSON.parse(fs.readFileSync(path.join(__dirname, 'faq.json'), 'utf8')).map(faq =>
        faq.questionPatternSource ? { ...faq, questionPattern: new RegExp(faq.questionPatternSource, 'i') } : faq
    );
    logger(LOG_LEVELS.INFO, 'FAQデータをfaq.jsonから正常に読み込みました。');
} catch (error) {
    logger(LOG_LEVELS.ERROR, 'faq.jsonの読み込みまたは解析に失敗しました:', { error: error.message });
}

let promptTemplate = '';
try {
    promptTemplate = fs.readFileSync(path.join(__dirname, 'prompt_template.txt'), 'utf8');
    logger(LOG_LEVELS.INFO, 'プロンプトテンプレートをprompt_template.txtから正常に読み込みました。');
} catch (error) {
    logger(LOG_LEVELS.ERROR, 'prompt_template.txtの読み込みに失敗しました:', { error: error.message });
}

let requestCountToday = 0;
let lastResetDate = new Date().toLocaleDateString();
const QUOTA_DATA_FILE_PATH = path.join(__dirname, 'quota_data.json');

const userChatSessions = {};
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function loadQuotaData() {
    try {
        if (fs.existsSync(QUOTA_DATA_FILE_PATH)) {
            const data = fs.readFileSync(QUOTA_DATA_FILE_PATH, 'utf8');
            const parsedData = JSON.parse(data);
            requestCountToday = parsedData.requestCountToday || 0;
            lastResetDate = parsedData.lastResetDate || new Date().toLocaleDateString();
            logger(LOG_LEVELS.INFO, 'カウントデータをファイルから読み込みました:', parsedData);
        } else {
            logger(LOG_LEVELS.WARN, 'カウントデータファイルが見つかりません。新規に作成します。');
            saveQuotaData();
        }
    } catch (error) {
        logger(LOG_LEVELS.ERROR, 'カウントデータの読み込みに失敗しました:', { error: error.message });
        requestCountToday = 0;
        lastResetDate = new Date().toLocaleDateString();
    }
}

function saveQuotaData() {
    try {
        const dataToSave = JSON.stringify({ requestCountToday, lastResetDate }, null, 2);
        fs.writeFileSync(QUOTA_DATA_FILE_PATH, dataToSave, 'utf8');
        logger(LOG_LEVELS.INFO, 'カウントデータをファイルに保存しました:', { requestCountToday, lastResetDate });
    } catch (error) {
        logger(LOG_LEVELS.ERROR, 'カウントデータの保存に失敗しました:', { error: error.message });
    }
}

loadQuotaData();

function resetCountIfNewDay() {
    const today = new Date().toLocaleDateString();
    if (today !== lastResetDate) {
        requestCountToday = 0;
        lastResetDate = today;
        logger(LOG_LEVELS.INFO, '日付が変わったため、APIリクエストカウントをリセットしました。');
        saveQuotaData();
    }
}

/**
 * ユーザーメッセージに一致するFAQを探し、回答と関連リンク情報を返す
 * @param {string} userMessage ユーザーからのメッセージ
 * @returns {object|null} 見つかった場合は { answer: string, relatedLink?: string, linkText?: string }、見つからない場合は null
 */
function findFaqAnswer(userMessage) {
    const lowerUserMessage = userMessage.toLowerCase();
    for (const faq of faqData) {
        // 1. 最初に questionPattern (正規表現) でのマッチを試みます。これはより複雑なルールを表現できます。
        if (faq.questionPattern && faq.questionPattern.test(lowerUserMessage)) {
            return {
                answer: faq.answer,
                relatedLink: faq.relatedLink,
                linkText: faq.linkText
            };
        }

        // 2. 次に、keywords でのマッチを試みます。
        if (faq.keywords) {
            // ★★★★★ 修正点 ★★★★★
            // キーワードのいずれかが「単語として」メッセージに含まれているかチェックします。
            const match = faq.keywords.some(keyword => {
                // 正規表現で使われる特殊文字をエスケープします (例: C++ など)
                const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // 単語境界 `\b` を使って、単語として完全に一致するかをチェックする正規表現を作成します。
                // これにより、「ペット」は "ペット" という単語にのみマッチし、"ペットボトル" の一部としてはマッチしなくなります。
                // 'i' フラグにより、大文字と小文字は区別されません。
                const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
                // 元のメッセージに対して正規表現をテストします。
                return regex.test(userMessage);
            });

            if (match) {
                 return {
                    answer: faq.answer,
                    relatedLink: faq.relatedLink,
                    linkText: faq.linkText
                };
            }
            // ★★★★★★★★★★★★★★★
        }
    }
    return null;
}


app.get('/api/quota_status', (req, res) => {
    resetCountIfNewDay();
    const remainingRequests = dailyRequestLimit - requestCountToday;
    res.json({
        limit: dailyRequestLimit,
        used: requestCountToday,
        remaining: remainingRequests < 0 ? 0 : remainingRequests
    });
});

app.post('/api/chat', async (req, res) => {
    logger(LOG_LEVELS.INFO, "--- /api/chat リクエスト受信 ---", { body: req.body, ip: req.ip });
    resetCountIfNewDay();

    if (requestCountToday >= dailyRequestLimit) {
        logger(LOG_LEVELS.WARN, "本日の利用上限に達しました。", {
            ip: req.ip,
            userId: req.body.userId || 'defaultUser',
            limit: dailyRequestLimit,
            count: requestCountToday
        });
        return res.status(429).json({
            error: '本日の利用上限に達しました。明日またお試しください。',
            reply: '申し訳ありませんが、本日の利用可能な回数を超えました。明日以降に再度お試しいただけますでしょうか。',
            source: 'system'
        });
    }

    try {
        const userMessage = req.body.message;
        const forceAI = req.body.forceAI || false;
        const userId = req.body.userId || 'defaultUser';

        logger(LOG_LEVELS.DEBUG, "[SERVER.JS] 受信データ:", { userMessage, forceAI, userId });

        if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
            logger(LOG_LEVELS.WARN, "無効なメッセージを受信しました。", { userMessage, userId, ip: req.ip });
            return res.status(400).json({ error: 'メッセージが無効です。', source: 'system' });
        }

        let replyMessage;
        let messageSource = 'ai';
        let relatedLinkInfo = null; // 関連リンク情報を保持する変数

        if (!forceAI) {
            const faqResult = findFaqAnswer(userMessage); // faqResult は { answer: "...", relatedLink: "...", linkText: "..." } または null
            if (faqResult && faqResult.answer) {
                logger(LOG_LEVELS.INFO, '[SERVER.JS] FAQからの応答が見つかりました:', { answer: faqResult.answer.substring(0, 50) + "...", link: faqResult.relatedLink, userId });
                replyMessage = faqResult.answer;
                // relatedLink と linkText が存在する場合、それらを保持
                if (faqResult.relatedLink && faqResult.linkText) {
                    relatedLinkInfo = { url: faqResult.relatedLink, text: faqResult.linkText };
                    // 回答にリンク情報を追記（クライアント側でHTMLとして解釈されることを想定）
                    replyMessage += `\n<br>詳しくはこちらもご覧ください: <a href="${faqResult.relatedLink}" target="_blank" rel="noopener noreferrer">${faqResult.linkText}</a>`;
                }
                messageSource = 'faq';
            } else {
                logger(LOG_LEVELS.INFO, "[SERVER.JS] FAQに該当する回答はありませんでした。", { userMessage, userId });
            }
        } else {
            logger(LOG_LEVELS.INFO, "[SERVER.JS] forceAIフラグがtrueのため、FAQ検索をスキップします。", { userId });
        }

        if (!replyMessage) {
            requestCountToday++;
            logger(LOG_LEVELS.INFO, `[SERVER.JS] 本日 ${requestCountToday} 回目のAPIリクエストです。`, { userId, limit: dailyRequestLimit });
            saveQuotaData();

            logger(LOG_LEVELS.INFO, `[SERVER.JS] ${forceAI ? '強制的に' : 'FAQに該当なしのため、'}Gemini APIに問い合わせます。`, { userId });

            if (!userChatSessions[userId]) {
                logger(LOG_LEVELS.INFO, `[SERVER.JS] ユーザーID '${userId}' のための新しいChatSessionを作成します。`);
                if (!genAI || typeof genAI.getGenerativeModel !== 'function') {
                    logger(LOG_LEVELS.ERROR, "致命的エラー: genAI.getGenerativeModel が関数ではありません！", { genAI_details: genAI ? Object.keys(genAI) : "undefined" });
                    return res.status(500).json({ error: 'サーバー設定エラー (AI SDK初期化)。', source: 'system' });
                }
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: promptTemplate.replace('{{conversationHistory}}', '').replace(/顧客からの新しい質問: 「{{userMessage}}」/, '').trim(),
                });
                logger(LOG_LEVELS.INFO, "[SERVER.JS] Model instance obtained. Attempting to start chat.", { userId });
                userChatSessions[userId] = model.startChat({ history: [] });
                logger(LOG_LEVELS.INFO, "[SERVER.JS] Chat session started.", { userId });
            }

            const chat = userChatSessions[userId];
            if (!chat || typeof chat.sendMessage !== 'function') {
                logger(LOG_LEVELS.ERROR, "致命的エラー: Chat session object is invalid.", { userId, chatSession: chat ? Object.keys(chat) : "undefined" });
                return res.status(500).json({ error: 'サーバー設定エラー (Invalid chat session)。', source: 'system' });
            }

            logger(LOG_LEVELS.DEBUG, "[SERVER.JS] chat.sendMessage() を呼び出します。", { userMessage, userId });
            const result = await chat.sendMessage(userMessage);
            const response = result.response;
            replyMessage = response.text();
            messageSource = 'ai';
            logger(LOG_LEVELS.INFO, '[SERVER.JS] Geminiからの応答 (ChatSession):', { reply: replyMessage ? replyMessage.substring(0, 100) + "..." : "undefined", userId });
        }
        // フロントエンドへの応答オブジェクトに linkInfo を含める (存在する場合)
        const responseObject = { reply: replyMessage, source: messageSource };
        if (messageSource === 'faq' && relatedLinkInfo) { // FAQからの応答でリンク情報がある場合のみ
             // HTMLとして送信するので、ここでは特に加工しない
        }

        logger(LOG_LEVELS.INFO, "[SERVER.JS] フロントエンドへの応答データ:", { reply: replyMessage.substring(0,50)+"...", source: messageSource, relatedLink: relatedLinkInfo, userId });
        res.json(responseObject);

    } catch (error) {
        logger(LOG_LEVELS.ERROR, '[SERVER.JS] /api/chat エンドポイントでエラーが発生しました:', { error: error.message, stack: error.stack, userId: req.body.userId || 'defaultUser', ip: req.ip });
        res.status(500).json({ error: 'AIとの通信中にエラーが発生しました。', source: 'system' });
    }
    logger(LOG_LEVELS.INFO, "--- /api/chat 処理終了 ---", { userId: req.body.userId || 'defaultUser'});
});

app.listen(port, () => {
  logger(LOG_LEVELS.INFO, `サーバーが http://localhost:${port} で起動しました`);
  logger(LOG_LEVELS.INFO, `チャット画面にはブラウザで http://localhost:${port} にアクセスしてください。`);
}).on('error', (err) => {
  logger(LOG_LEVELS.ERROR, 'サーバー起動時に致命的なエラーが発生しました:', {error: err.message, stack: err.stack});
  process.exit(1);
});

setInterval(() => {
    logger(LOG_LEVELS.DEBUG, `サーバープロセスは稼働中です。(デバッグ用)`);
}, 300000);
