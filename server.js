// 1. Expressを読み込む
const express = require('express');
const path = require('path');
console.log("--- Requiring '@google/generative-ai' module (like in test-gemini.js) ---");
// ★★★ test-gemini.js と同じSDK (@google/generative-ai) を使用する ★★★
// これにより、GoogleGenerativeAI クラスが直接インポートされ、
// genAI.getGenerativeModel が利用可能になることが期待される。
// 事前に npm install @google/generative-ai が実行されている必要がある。
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

require('dotenv').config();
const fs = require('fs');

const app = express();
const port = 3000;

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("エラー: 環境変数 GEMINI_API_KEY が設定されていません。");
    process.exit(1);
}

console.log("--- Initializing GoogleGenerativeAI with API_KEY ---");
const genAI = new GoogleGenerativeAI(API_KEY);
console.log("[SERVER.JS] genAI instance created with new GoogleGenerativeAI(API_KEY).");

console.log("[SERVER.JS] Checking for genAI.getGenerativeModel method...");
if (genAI && typeof genAI.getGenerativeModel === 'function') {
    console.log("[SERVER.JS] genAI.getGenerativeModel IS a function. SDK initialized correctly!");
} else {
    console.error("[SERVER.JS] genAI.getGenerativeModel IS NOT a function. This is unexpected if using @google/generative-ai.");
    if (genAI) {
        console.error("[SERVER.JS] Available methods/props on genAI:", Object.keys(genAI));
        if (genAI.models) { // genAI.models が存在する場合、その内容もログに出力 (通常は直接 genAI にメソッドがある)
            console.error("[SERVER.JS] Available methods/props on genAI.models:", Object.keys(genAI.models));
            }
    }
    console.error("Please ensure '@google/generative-ai' is installed and correctly imported.");
    process.exit(1);
}

// (この後のコードは、genAIが正しく初期化された前提で進む)
let faqData = [];
try { faqData = JSON.parse(fs.readFileSync(path.join(__dirname, 'faq.json'), 'utf8')).map(faq => faq.questionPatternSource ? { ...faq, questionPattern: new RegExp(faq.questionPatternSource, 'i') } : faq); console.log('FAQデータをfaq.jsonから正常に読み込みました。'); } catch (error) { console.error('faq.jsonの読み込みまたは解析に失敗しました:', error); }
let promptTemplate = '';
try { promptTemplate = fs.readFileSync(path.join(__dirname, 'prompt_template.txt'), 'utf8'); console.log('プロンプトテンプレートをprompt_template.txtから正常に読み込みました。'); } catch (error) { console.error('prompt_template.txtの読み込みに失敗しました:', error); }
const DAILY_REQUEST_LIMIT = 500;
let requestCountToday = 0;
let lastResetDate = new Date().toLocaleDateString();
const QUOTA_DATA_FILE_PATH = path.join(__dirname, 'quota_data.json');

const userChatSessions = {};
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

function loadQuotaData() { try { if (fs.existsSync(QUOTA_DATA_FILE_PATH)) { const data = fs.readFileSync(QUOTA_DATA_FILE_PATH, 'utf8'); const parsedData = JSON.parse(data); requestCountToday = parsedData.requestCountToday || 0; lastResetDate = parsedData.lastResetDate || new Date().toLocaleDateString(); console.log('カウントデータをファイルから読み込みました:', parsedData); } else { console.log('カウントデータファイルが見つかりません。新規に作成します。'); saveQuotaData(); } } catch (error) { console.error('カウントデータの読み込みに失敗しました:', error); requestCountToday = 0; lastResetDate = new Date().toLocaleDateString(); } }
function saveQuotaData() { try { const dataToSave = JSON.stringify({ requestCountToday, lastResetDate }, null, 2); fs.writeFileSync(QUOTA_DATA_FILE_PATH, dataToSave, 'utf8'); console.log('カウントデータをファイルに保存しました:', { requestCountToday, lastResetDate }); } catch (error) { console.error('カウントデータの保存に失敗しました:', error); } }
loadQuotaData();
function resetCountIfNewDay() { const today = new Date().toLocaleDateString(); if (today !== lastResetDate) { requestCountToday = 0; lastResetDate = today; console.log('日付が変わったため、APIリクエストカウントをリセットしました。'); saveQuotaData(); } }
function findFaqAnswer(userMessage) { const lowerUserMessage = userMessage.toLowerCase(); for (const faq of faqData) { if (faq.questionPattern && faq.questionPattern.test(lowerUserMessage)) { return faq.answer; } if (faq.keywords && faq.keywords.some(keyword => lowerUserMessage.includes(keyword.toLowerCase()))) { return faq.answer; } } return null; }


app.get('/api/quota_status', (req, res) => { resetCountIfNewDay(); const remainingRequests = DAILY_REQUEST_LIMIT - requestCountToday; res.json({ limit: DAILY_REQUEST_LIMIT, used: requestCountToday, remaining: remainingRequests < 0 ? 0 : remainingRequests }); });
app.post('/api/chat', async (req, res) => {
    console.log("------------------------------------------");
    console.log("[SERVER.JS] /api/chat リクエスト受信 (タイムスタンプ:", new Date().toISOString(), ")");
    resetCountIfNewDay();

    if (requestCountToday >= DAILY_REQUEST_LIMIT) {
        return res.status(429).json({ error: '本日の利用上限に達しました。明日またお試しください。', reply: '申し訳ありませんが、本日の利用可能な回数を超えました。明日以降に再度お試しいただけますでしょうか。', source: 'system' });
    }

    try {
        const userMessage = req.body.message;
        const forceAI = req.body.forceAI || false;
        const userId = req.body.userId || 'defaultUser';

        console.log("[SERVER.JS] 受信データ: userMessage =", `"${userMessage}"`, ", forceAI =", forceAI, ", userId =", userId);

        if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
            return res.status(400).json({ error: 'メッセージが無効です。', source: 'system' });
        }

        let replyMessage;
        let messageSource = 'ai';

        if (!forceAI) {
            const faqAnswer = findFaqAnswer(userMessage);
            if (faqAnswer) {
                console.log('[SERVER.JS] FAQからの応答が見つかりました:', `"${faqAnswer}"`);
                replyMessage = faqAnswer;
                messageSource = 'faq';
            } else {
                console.log("[SERVER.JS] FAQに該当する回答はありませんでした。");
            }
        } else {
            console.log("[SERVER.JS] forceAIフラグがtrueのため、FAQ検索をスキップします。");
        }

        if (!replyMessage) {
            requestCountToday++;
            console.log(`[SERVER.JS] 本日 ${requestCountToday} 回目のAPIリクエストです。`);
            saveQuotaData();

            console.log(`[SERVER.JS] ${forceAI ? '強制的に' : 'FAQに該当なしのため、'}Gemini APIに問い合わせます。`);

            if (!userChatSessions[userId]) {
                console.log(`[SERVER.JS] ユーザーID '${userId}' のための新しいChatSessionを作成します。`);
                if (!genAI || typeof genAI.getGenerativeModel !== 'function') {
                    console.error("Fatal: genAI.getGenerativeModel is not a function! Check genAI object.");
                    if (genAI) console.dir(genAI, {depth: 1});
                    // genAI.models のログは不要になるか、genAI自体の確認で十分
                    return res.status(500).json({ error: 'サーバー設定エラー (AI SDK初期化)。', source: 'system' });
                }
                // ★★★ モデル取得とChatSessionの作成方法を genAI.models を経由する形に修正 ★★★
                const model = genAI.getGenerativeModel({ // genAI から直接呼び出す
                    model: "gemini-1.5-flash-latest",
                    systemInstruction: promptTemplate.replace('{{conversationHistory}}', '').replace(/顧客からの新しい質問: 「{{userMessage}}」/, '').trim(),
                });
                console.log("[SERVER.JS] Model instance obtained via genAI.getGenerativeModel(). Attempting to start chat.");
                userChatSessions[userId] = model.startChat({
                    history: [],
                });
                console.log("[SERVER.JS] Chat session started via model.startChat()");
            }
            const chat = userChatSessions[userId];
            
            if (!chat || typeof chat.sendMessage !== 'function') {
                console.error("Fatal: Chat session object is invalid or does not have sendMessage method.");
                return res.status(500).json({ error: 'サーバー設定エラー (Invalid chat session)。', source: 'system' });
            }

            console.log("[SERVER.JS] chat.sendMessage() を呼び出します。メッセージ:", `"${userMessage}"`);
            const result = await chat.sendMessage(userMessage);
            const response = result.response;
            replyMessage = response.text();
            messageSource = 'ai';
            console.log('[SERVER.JS] Geminiからの応答 (ChatSession):', replyMessage ? replyMessage.substring(0,100) + "..." : "undefined");
        }
        console.log("[SERVER.JS] フロントエンドへの応答データ:", { reply: replyMessage, source: messageSource });
        res.json({ reply: replyMessage, source: messageSource });
    } catch (error) {
        console.error('[SERVER.JS] /api/chat エンドポイントでエラーが発生しました:', error);
        res.status(500).json({ error: 'AIとの通信中にエラーが発生しました。', source: 'system' });
    }
    console.log("[SERVER.JS] /api/chat 処理終了");
    console.log("------------------------------------------");
});

app.listen(port, () => {
  console.log(`サーバーが http://localhost:${port} で起動しました`);
  console.log('チャット画面にはブラウザで http://localhost:3000 にアクセスしてください。');
}).on('error', (err) => {
  console.error('サーバー起動時に致命的なエラーが発生しました:', err);
  process.exit(1); // エラー発生時はプロセスを終了
});

// デバッグ用: プロセスが生きているか確認するために定期的にログを出力
setInterval(() => {
    const now = new Date();
    console.log(`[${now.toLocaleTimeString()}] サーバープロセスは稼働中です。(デバッグ用)`);
}, 30000); // 30秒ごと
