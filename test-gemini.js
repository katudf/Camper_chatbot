// 1. SDKを読み込む
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 2. APIキーを設定する (環境変数から読み込むのがより安全ですが、まずは直接記述します)
//    重要：実際の運用では、APIキーをコードに直接書くのは避け、環境変数などを使用してください。
const API_KEY = "AIzaSyBHdujfjOYHXeLGgHsOMj6ZCtB_jO6QIfY"; // ★★★ 取得したAPIキーに置き換えてください ★★★

// 3. GenerativeAIのインスタンスを作成
const genAI = new GoogleGenerativeAI(API_KEY);

// 4. 非同期関数を定義して、APIを呼び出す
async function run() {
  try {
    // 使用するモデルを指定 (例: gemini-1.5-flash-latest)
    // 利用可能なモデルはドキュメントで確認してください。
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    const prompt = "日本の本州で一番面積の広い都府県はどこですか？";

    console.log(`送信するプロンプト: ${prompt}`);

    // テキスト生成リクエストを送信
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log("Geminiからの応答:");
    console.log(text);

  } catch (error) {
    console.error("エラーが発生しました:", error);
  }
}

// 5. 関数を実行
run();