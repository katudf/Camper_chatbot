// public/script.js の全内容

document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    
    let loadingIntervalId = null;

    // サーバーの状態を確認し、UIの初期化を行う
    checkServerStatus(userInput);

    // イベントリスナーの設定
    sendButton.addEventListener('click', () => handleUserSubmit(userInput));
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !sendButton.disabled) {
            handleUserSubmit(userInput);
        }
    });
    userInput.addEventListener('input', () => updateSendButtonState(userInput, sendButton));
});

/**
 * サーバーの状態を確認し、UIを初期化する
 */
async function checkServerStatus(userInput) {
    const connectingMessage = document.getElementById('connecting-message');
    const greetingContent = document.getElementById('greeting-content');

    try {
        const response = await fetch('https://camper-chatbot.onrender.com/api/health');
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        
        connectingMessage.style.display = 'none';
        greetingContent.style.display = 'block';
        createShortcutButtons();
        userInput.disabled = false;
        userInput.focus();
        updateSendButtonState(userInput, document.getElementById('sendButton'));

    } catch (error) {
        console.error('Server check failed:', error);
        connectingMessage.textContent = 'サーバーに接続できませんでした。時間をおいてページを再読み込みしてください。';
    }
}

/**
 * ユーザーが手入力で送信ボタンを押したときの処理
 */
function handleUserSubmit(userInput) {
    const messageText = userInput.value.trim();
    if (messageText) {
        userInput.value = '';
        updateSendButtonState(userInput, document.getElementById('sendButton'));
        submitMessage(messageText);
    }
}

/**
 * メッセージを送信し、応答を待って表示する共通の処理
 * @param {string} messageText 送信するメッセージ
 */
async function submitMessage(messageText) {
    addMessageToChat(messageText, 'user');
    document.getElementById('shortcutButtons').style.display = 'none';

    let waitingMessageElement = null;
    let isResponseReceived = false;

    // 3秒後に「起動中メッセージ」を表示するタイマー
    const waitingTimer = setTimeout(() => {
        if (!isResponseReceived) {
            const waitingText = 'サーバーを起動中です...<br>最大30秒ほどかかる場合があります。';
            waitingMessageElement = addMessageToChat(waitingText, 'bot');
        }
    }, 3000);

    // 「考えています」メッセージの表示
    const loadingMessageBaseText = '考えています';
    const loadingMessageElement = addMessageToChat(loadingMessageBaseText + '.', 'bot', true);
    let loadingDots = 1;
    const loadingIntervalId = setInterval(() => {
        loadingDots = (loadingDots % 3) + 1;
        const pElement = loadingMessageElement?.querySelector('p');
        if (pElement) pElement.textContent = loadingMessageBaseText + '.'.repeat(loadingDots);
    }, 700);


    try {
        const reply = await sendMessageToServer(messageText); // サーバーにメッセージを送信
        isResponseReceived = true;
        addMessageToChat(reply, 'bot');

    } catch (error) {
        isResponseReceived = true;
        console.error('通信エラー:', error);
        addMessageToChat('申し訳ありません、通信エラーが発生しました。ネットワーク接続を確認して再度お試しください。', 'bot');
    
    } finally {
        // すべての処理が終わった後に不要なメッセージを消す
        clearTimeout(waitingTimer);
        clearInterval(loadingIntervalId);
        if (waitingMessageElement) removeMessageFromChat(waitingMessageElement.id);
        if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);
    }
}


/**
 * サーバーへメッセージを送信し、応答テキストを返す
 * @param {string} messageText 
 * @returns {Promise<string>}
 */
async function sendMessageToServer(messageText) {
    let userId = localStorage.getItem('chatbotUserId');
    if (!userId) {
        userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        localStorage.setItem('chatbotUserId', userId);
    }

    const response = await fetch('https://camper-chatbot.onrender.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, userId: userId }),
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.reply || 'サーバーエラーが発生しました。');
    }
    return data.reply;
}

/**
 * ショートカットボタンを作成する
 */
function createShortcutButtons() {
    const shortcutButtonsContainer = document.getElementById('shortcutButtons');
    if (!shortcutButtonsContainer) return;

    const shortcuts = [
        { label: "料金は？", question: "レンタル料金について教えてください" },
        { label: "予約方法は？", question: "予約方法を教えてください" },
        { label: "車両の種類は？", question: "どんな車両がありますか？" },
        { label: "ペットOK？", question: "ペットは同伴できますか？" }
    ];

    shortcutButtonsContainer.innerHTML = '';
    shortcuts.forEach(shortcut => {
        const button = document.createElement('button');
        button.classList.add('shortcut-button');
        button.textContent = shortcut.label;
        button.addEventListener('click', () => {
            // ★★★★★ 共通の送信処理を呼び出すように修正 ★★★★★
            submitMessage(shortcut.question);
        });
        shortcutButtonsContainer.appendChild(button);
    });
}


function updateSendButtonState(userInput, sendButton) {
    sendButton.disabled = userInput.value.trim() === '';
}

function addMessageToChat(text, sender, isLoading = false) {
    const messageId = `msg-${Date.now()}-${Math.random()}`;
    const messageElement = document.createElement('div');
    messageElement.id = messageId;
    messageElement.classList.add('message', `${sender}-message`);
    if (isLoading) {
        messageElement.classList.add('loading-message');
    }
    const pElement = document.createElement('p');
    if (sender === 'bot') {
        const htmlWithLinks = text.replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        const cleanHtml = DOMPurify.sanitize(htmlWithLinks);
        pElement.innerHTML = cleanHtml;
    } else {
        pElement.textContent = text;
    }
    messageElement.appendChild(pElement);
    document.getElementById('chatMessages').appendChild(messageElement);
    document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
    return messageElement;
}

function removeMessageFromChat(messageId) {
    const messageToRemove = document.getElementById(messageId);
    if (messageToRemove) {
        messageToRemove.remove();
    }
}