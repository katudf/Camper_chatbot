document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const shortcutButtonsContainer = document.getElementById('shortcutButtons');
    const remainingQuotaValueElement = document.getElementById('remainingQuotaValue');

    let loadingIntervalId = null;
    let loadingDots = 0;

    const shortcuts = [
        { label: "料金は？", question: "レンタル料金について教えてください" },
        { label: "予約方法は？", question: "予約方法を教えてください" },
        { label: "車両の種類は？", question: "どんな車両がありますか？" },
        { label: "ペットOK？", question: "ペットは同伴できますか？" }
    ];

    function createShortcutButtons() {
        if (!shortcutButtonsContainer) return;
        shortcutButtonsContainer.innerHTML = '';
        shortcuts.forEach(shortcut => {
            const button = document.createElement('button');
            button.classList.add('shortcut-button');
            button.textContent = shortcut.label;
            button.addEventListener('click', () => {
                addMessageToChat(shortcut.question, 'user');
                sendMessage(shortcut.question);
                shortcutButtonsContainer.style.display = 'none';
            });
            shortcutButtonsContainer.appendChild(button);
        });
    }

    async function fetchAndUpdateQuota() {
        try {
            const response = await fetch('https://camper-chatbot.onrender.com/api/chat');
            if (!response.ok) {
                if (remainingQuotaValueElement) remainingQuotaValueElement.textContent = '取得エラー';
                return;
            }
            const data = await response.json();
            if (remainingQuotaValueElement) {
                remainingQuotaValueElement.textContent = data.remaining;
            }
        } catch (error) {
            if (remainingQuotaValueElement) remainingQuotaValueElement.textContent = '表示エラー';
            console.error('API利用状況の取得エラー:', error);
        }
    }

    function updateSendButtonState() {
        sendButton.disabled = userInput.value.trim() === '';
    }

    async function handleUserSubmit() { // asyncキーワードを追加
        const messageText = userInput.value.trim();
        if (messageText) {
            addMessageToChat(messageText, 'user');
            userInput.value = '';
            updateSendButtonState();
            shortcutButtonsContainer.style.display = 'none'; // ユーザー入力後にショートカットを非表示
            
            // ★★★★★ ここから修正・追加 ★★★★★
            let waitingMessageElement = null;
            let isResponseReceived = false;

            // 3秒後に「起動中メッセージ」を表示するタイマー
            const waitingTimer = setTimeout(() => {
                if (!isResponseReceived) {
                    const waitingText = 'サーバーを起動中です...<br>30～50秒ほどかかる場合があります。';
                    waitingMessageElement = addMessageToChat(waitingText, 'bot');
                }
            }, 3000);

            try {
                const response = await sendMessage(messageText); // sendMessageをawaitで待つ
                isResponseReceived = true; // 応答が来たことを記録
                clearTimeout(waitingTimer); // タイマーを解除

                // もし「起動中メッセージ」が表示されていたら削除する
                if (waitingMessageElement) {
                    removeMessageFromChat(waitingMessageElement.id);
                }

                // サーバーからの応答をチャットに追加
                addMessageToChat(response, 'bot');

            } catch (error) {
                isResponseReceived = true;
                clearTimeout(waitingTimer);
                if (waitingMessageElement) {
                    removeMessageFromChat(waitingMessageElement.id);
                }
                console.error('通信エラー:', error);
                addMessageToChat('申し訳ありません、通信エラーが発生しました。ネットワーク接続を確認して再度お試しください。', 'bot');
            }
            // ★★★★★ ここまで修正・追加 ★★★★★
        }
    }
    
    sendButton.addEventListener('click', () => handleUserSubmit(userInput, sendButton));
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !sendButton.disabled) {
            handleUserSubmit(userInput, sendButton);
        }
    });
    userInput.addEventListener('input', () => updateSendButtonState(userInput, sendButton));

    async function sendMessage(messageText) {
        if (!messageText) return;
        // userInput.focus(); // handleUserSubmitに移動または不要なら削除検討
        const loadingMessageBaseText = 'キャン太が考えています';
        const loadingMessageElement = addMessageToChat(loadingMessageBaseText + '.', 'bot', true);
        loadingDots = 1;
        if (loadingIntervalId) clearInterval(loadingIntervalId);
        loadingIntervalId = setInterval(() => {
            loadingDots = (loadingDots % 3) + 1;
            const dotsString = '.'.repeat(loadingDots);
            const pElement = loadingMessageElement?.querySelector('p');
            if (pElement) {
                pElement.textContent = loadingMessageBaseText + dotsString;
            } else {
                clearInterval(loadingIntervalId);
                loadingIntervalId = null;
            }
        }, 700);

        try {
            let userId = localStorage.getItem('chatbotUserId');
            if (!userId) {
                userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                localStorage.setItem('chatbotUserId', userId);
            }

            const response = await fetch('https://camper-chatbot.onrender.com/api/chat', { // あなたのバックエンドURL
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText, userId: userId }),
            });

            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);
            if (loadingIntervalId) clearInterval(loadingIntervalId);
            // fetchAndUpdateQuota(); // handleUserSubmit側で必要なら呼び出すか、ここで維持するか検討
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.reply || 'サーバーエラーが発生しました。');
            }

            return data.reply; // ★★★★★ 応答メッセージを返すように変更

        } catch (error) {
            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);
            if (loadingIntervalId) clearInterval(loadingIntervalId);
            // fetchAndUpdateQuota(); // エラー時も呼び出すか検討
            throw error; // ★★★★★ エラーを呼び出し元に投げるように変更
        }
    }

    /**
     * チャットにメッセージを追加する関数
     * @param {string} text 表示するテキスト（Markdownリンクを含む場合がある）
     * @param {string} sender 'user' または 'bot'
     * @param {boolean} isLoading ローディングメッセージかどうか
     * @returns {HTMLElement} 追加されたメッセージ要素
     */
    function addMessageToChat(text, sender, isLoading = false) {
        const messageId = `msg-${Date.now()}-${Math.random()}`; // ★★★★★ すべてのメッセージにユニークIDを付与
        const messageElement = document.createElement('div');
        messageElement.id = messageId;
        messageElement.classList.add('message', `${sender}-message`);
        if (isLoading) {
            messageElement.classList.add('loading-message');
        }

        const pElement = document.createElement('p');
        
        if (sender === 'bot') {
            // MarkdownリンクをHTMLの<a>タグに変換
            const htmlWithLinks = text.replace(
                /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>' // &lt; &gt; を < > に修正
            );
            // DOMPurifyでのサニタイズは既に実装済みなのでそのまま活用
            const cleanHtml = DOMPurify.sanitize(htmlWithLinks);
            pElement.innerHTML = cleanHtml; // ★★★★★ innerHTMLを使って<br>などを反映
        } else {
            // ユーザー入力は安全のためtextContentを使い、テキストとしてそのまま表示
            pElement.textContent = text;
        }
        
        messageElement.appendChild(pElement);
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return messageElement;
    }

    function removeMessageFromChat(messageId) {
        const messageToRemove = document.getElementById(messageId);
        if (messageToRemove) {
            messageToRemove.remove();
        }
    }

    // script.js に追加
    async function checkServerStatus() {
        const connectingMessage = document.getElementById('connecting-message');
        const greetingContent = document.getElementById('greeting-content');
        const userInput = document.getElementById('userInput');

        try {
            // Renderサーバーのヘルスチェックエンドポイントを叩く
            const response = await fetch('https://camper-chatbot.onrender.com/api/health');

            // 応答が正常（200 OK）でなければエラーとして扱う
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }

            // 成功した場合
            connectingMessage.style.display = 'none'; // 「接続中」を非表示
            greetingContent.style.display = 'block'; // あいさつ文とボタンを表示
            createShortcutButtons(); // ショートカットボタンもここで生成
            userInput.disabled = false; // 入力欄を有効化
            userInput.focus();
            updateSendButtonState();

        } catch (error) {
            // 失敗した場合
            console.error('Server check failed:', error);
            connectingMessage.textContent = 'サーバーに接続できませんでした。時間をおいてページを再読み込みしてください。';
            // ユーザー入力は無効のまま
        }
    }
    
    // 初期化処理
    // fetchAndUpdateQuota(); // 初期表示時に呼び出すか検討。現状はユーザー送信後に呼び出される
    checkServerStatus(); // ★★★★★ サーバー接続確認処理を呼び出す
});
