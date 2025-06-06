// 1. ライブラリの読み込み
const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const fs = require('fs');
// Firebase関連のモジュールをインポート
const { initializeApp } = require("firebase/app");
const { getFirestore, collection, addDoc, serverTimestamp } = require("firebase/firestore");


// --- 簡易ロガー関数の導入 (変更なし) ---
const LOG_LEVELS = {
    INFO: 'INFO',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG',
    WARN: 'WARN'
};
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
    logger(LOG_LEVELS.ERROR, '設定ファイルの読み込みまたは解析に失敗しました。', { error: error.message });
}

// --- Firebaseの初期化 ---
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
logger(LOG_LEVELS.INFO, "Firebase Firestore has been initialized successfully.");
// --- Firebase初期化ここまで ---


const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    logger(LOG_LEVELS.ERROR, "環境変数 GEMINI_API_KEY が設定されていません。");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

let promptTemplate = '';
try {
    promptTemplate = fs.readFileSync(path.join(__dirname, 'prompt_template.txt'), 'utf8');
    logger(LOG_LEVELS.INFO, 'プロンプトテンプレートを読み込みました。');
} catch (error) {
    logger(LOG_LEVELS.ERROR, 'prompt_template.txtの読み込みに失敗しました:', { error: error.message });
}

let requestCountToday = 0;
let lastResetDate = new Date().toLocaleDateString();
const QUOTA_DATA_FILE_PATH = path.join(__dirname, 'quota_data.json');
const userChatSessions = {};

function loadQuotaData() {
    try {
        if (fs.existsSync(QUOTA_DATA_FILE_PATH)) {
            const data = fs.readFileSync(QUOTA_DATA_FILE_PATH, 'utf8');
            const parsedData = JSON.parse(data);
            requestCountToday = parsedData.requestCountToday || 0;
            lastResetDate = parsedData.lastResetDate || new Date().toLocaleDateString();
        } else {
            saveQuotaData();
        }
    } catch (error) {
        logger(LOG_LEVELS.ERROR, 'カウントデータの読み込みに失敗しました:', { error: error.message });
    }
}

function saveQuotaData() {
    try {
        const dataToSave = JSON.stringify({ requestCountToday, lastResetDate }, null, 2);
        fs.writeFileSync(QUOTA_DATA_FILE_PATH, dataToSave, 'utf8');
    } catch (error) {
        logger(LOG_LEVELS.ERROR, 'カウントデータの保存に失敗しました:', { error: error.message });
    }
}

function resetCountIfNewDay() {
    const today = new Date().toLocaleDateString();
    if (today !== lastResetDate) {
        requestCountToday = 0;
        lastResetDate = today;
        logger(LOG_LEVELS.INFO, '日付が変わったため、APIリクエストカウントをリセットしました。');
        saveQuotaData();
    }
}

loadQuotaData();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
        logger(LOG_LEVELS.WARN, "本日の利用上限に達しました。", { ip: req.ip });
        return res.status(429).json({
            reply: '申し訳ありませんが、本日の利用可能な回数を超えました。明日以降に再度お試しいただけますでしょうか。',
            source: 'system'
        });
    }

    try {
        const userMessage = req.body.message;
        const userId = req.body.userId || 'defaultUser';

        if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
            logger(LOG_LEVELS.WARN, "無効なメッセージを受信しました。", { userId, ip: req.ip });
            return res.status(400).json({ reply: 'メッセージが空です。', source: 'system' });
        }
        
        requestCountToday++;
        logger(LOG_LEVELS.INFO, `本日 ${requestCountToday} 回目のAPIリクエストです。`, { userId });
        saveQuotaData();

        logger(LOG_LEVELS.INFO, `Gemini APIに問い合わせます。`, { userId });

        if (!userChatSessions[userId]) {
            logger(LOG_LEVELS.INFO, `ユーザーID '${userId}' のための新しいChatSessionを作成します。`);
            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: promptTemplate,
            });
            userChatSessions[userId] = model.startChat({ history: [] });
            logger(LOG_LEVELS.INFO, "Chat session started.", { userId });
        }

        const chat = userChatSessions[userId];
        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        const replyMessage = response.text();

        logger(LOG_LEVELS.INFO, 'Geminiからの応答:', { reply: replyMessage.substring(0, 100) + "...", userId });

        // ★★★★★ 修正点 ★★★★★
        // Firestoreへの保存処理をtry...catchで囲む
        // これにより、もしDBへの保存に失敗しても、クライアントへの応答はブロックされない
        try {
            const conversationLog = {
                userId: userId,
                question: userMessage,
                answer: replyMessage,
                timestamp: serverTimestamp()
            };
            await addDoc(collection(db, "conversations"), conversationLog);
            logger(LOG_LEVELS.INFO, `会話ログをFirestoreに保存しました。`);
        } catch (dbError) {
            // DB保存エラーはログに出力するのみで、処理は続行する
            logger(LOG_LEVELS.ERROR, 'Firestoreへの会話ログ保存中にエラーが発生しました。', { error: dbError.message });
        }
        // ★★★★★ 修正ここまで ★★★★★

        // クライアントに応答を返す
        res.json({ reply: replyMessage, source: 'ai' });

    } catch (error) {
        logger(LOG_LEVELS.ERROR, '/api/chat でエラーが発生しました:', { error: error.message, stack: error.stack, userId: req.body.userId || 'defaultUser' });
        res.status(500).json({ reply: 'AIとの通信中にエラーが発生しました。しばらくしてからもう一度お試しください。', source: 'system' });
    }
});

app.listen(port, () => {
    logger(LOG_LEVELS.INFO, `サーバーが http://localhost:${port} で起動しました`);
}).on('error', (err) => {
    logger(LOG_LEVELS.ERROR, 'サーバー起動時に致命的なエラーが発生しました:', { error: err.message });
    process.exit(1);
});
