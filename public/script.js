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

    function handleUserSubmit() {
        const messageText = userInput.value.trim();
        if (messageText) {
            addMessageToChat(messageText, 'user');
            sendMessage(messageText);
            shortcutButtonsContainer.style.display = 'none';
            userInput.value = '';
            updateSendButtonState();
        }
    }
    
    sendButton.addEventListener('click', handleUserSubmit);
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !sendButton.disabled) {
            handleUserSubmit();
        }
    });
    userInput.addEventListener('input', updateSendButtonState);

    async function sendMessage(messageText) {
        if (!messageText) return;
        userInput.focus();

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

            const response = await fetch('https://camper-chatbot.onrender.com/api/chat', { // ← ここをRenderのURLに書き換える
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText, userId: userId }),
            });

            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);
            if (loadingIntervalId) clearInterval(loadingIntervalId);
            
            fetchAndUpdateQuota();
            const data = await response.json();

            if (!response.ok) {
                const errorMessage = data.reply || '申し訳ありません、エラーが発生しました。';
                addMessageToChat(errorMessage, 'bot');
                return;
            }

            addMessageToChat(data.reply, 'bot');

        } catch (error) {
            if (loadingMessageElement) removeMessageFromChat(loadingMessageElement.id);
            if (loadingIntervalId) clearInterval(loadingIntervalId);
            fetchAndUpdateQuota();
            console.error('通信エラー:', error);
            addMessageToChat('申し訳ありません、通信エラーが発生しました。ネットワーク接続を確認して再度お試しください。', 'bot');
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
        const messageId = isLoading ? `loading-${Date.now()}` : null;
        const messageElement = document.createElement('div');
        if (messageId) {
            messageElement.id = messageId;
        }
        messageElement.classList.add('message', `${sender}-message`);
        if (isLoading) {
            messageElement.classList.add('loading-message');
        }

        const pElement = document.createElement('p');
        
        if (sender === 'bot') {
            // ★★★★★ 修正点 ★★★★★
            // MarkdownリンクをHTMLの<a>タグに変換
            const htmlWithLinks = text.replace(
                /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
            );
            // DOMPurifyでサニタイズ処理を追加
            const cleanHtml = DOMPurify.sanitize(htmlWithLinks);
            pElement.innerHTML = cleanHtml;
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
    
    // 初期化処理
    fetchAndUpdateQuota();
    createShortcutButtons();
    userInput.disabled = false;
    userInput.focus();
    updateSendButtonState();
});
