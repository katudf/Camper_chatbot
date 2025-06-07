document.addEventListener('DOMContentLoaded', () => {

    // Firebase Configuration
    // この部分はあなたのFirebaseプロジェクトの設定情報に書き換えてください。
    const firebaseConfig = {
      apiKey: "AIzaSyBy78-xFFOm1WozcEDYdU72sRjS_8Q5xF8",
      authDomain: "camper-chatbot-logs.firebaseapp.com",
      projectId: "camper-chatbot-logs",
      storageBucket: "camper-chatbot-logs.firebasestorage.app",
      messagingSenderId: "448817696051",
      appId: "1:448817696051:web:ed8edc31eac61dbb4c8246"
    };
    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    // DOM Elements
    const loginContainer = document.getElementById('login-container');
    const editorContainer = document.getElementById('editor-container');
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const saveButton = document.getElementById('save-button');
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const userEmailSpan = document.getElementById('user-email');
    const loginErrorP = document.getElementById('login-error');
    const saveStatusP = document.getElementById('save-status');
    const promptForm = document.getElementById('prompt-form');

    // 各ドキュメントとHTML要素のIDのマッピングを更新
    const docFieldIds = {
        bot_personality: ['roleDescription', 'communicationPrinciples'],
        bot_control: ['inappropriateQuestionResponse', 'negativePrompt'],
        company_info: ['companyName', 'location', 'phone', 'businessHours', 'holidays', 'appealPoints', 'campaignInfo'],
        qna: ['qnaContent'],
        links: ['link_instagram', 'link_line', 'link_zil', 'link_crea', 'link_news', 'link_pricing', 'link_booking', 'link_checkoutFlow', 'link_checkinFlow', 'link_accidentResponse'],
        vehicle_zil: ['vehicle_zil_features'],
        vehicle_crea: ['vehicle_crea_features'],
        vehicle_common: ['commonEquipment', 'otherEquipment'],
        pricing: ['pricing_notes', 'longTermDiscounts', 'cancellationPolicy', 'paymentMethods'],
        procedures: ['checkoutFlow', 'checkinFlow', 'usageManners', 'prohibitedItems', 'accidentResponse'],
        policies: ['termsContent', 'privacyPolicyContent'],
        preparation: ['essentialItems', 'convenientItems'],
        recommendations: ['overnightSpots']
    };


    // --- Authentication Logic (変更なし) ---
    auth.onAuthStateChanged(user => {
        if (user) {
            loginContainer.style.display = 'none';
            editorContainer.style.display = 'block';
            userEmailSpan.textContent = `ログイン中: ${user.email}`;
            loadPromptData();
        } else {
            loginContainer.style.display = 'block';
            editorContainer.style.display = 'none';
            userEmailSpan.textContent = '';
        }
    });

    loginButton.addEventListener('click', () => {
        loginErrorP.textContent = '';
        const email = loginEmailInput.value;
        const password = loginPasswordInput.value;
        if (!email || !password) {
            loginErrorP.textContent = 'メールアドレスとパスワードを入力してください。';
            return;
        }
        auth.signInWithEmailAndPassword(email, password)
            .catch(error => {
                loginErrorP.textContent = `ログインに失敗しました: ${error.code}`;
                console.error("Login failed:", error);
            });
    });

    logoutButton.addEventListener('click', () => {
        auth.signOut();
    });

    // --- Firestore Data Handling Logic (変更なし) ---
    async function loadPromptData() {
        console.log("Loading prompt data from Firestore...");
        try {
            for (const [docId, fieldIds] of Object.entries(docFieldIds)) {
                const docRef = db.collection('prompts').doc(docId);
                const docSnap = await docRef.get();
                if (docSnap.exists) {
                    const data = docSnap.data();
                    fieldIds.forEach(fieldId => {
                        const element = document.getElementById(fieldId);
                        if (element && data[fieldId] !== undefined) {
                            element.value = data[fieldId];
                        }
                    });
                } else {
                    console.warn(`Document "${docId}" does not exist in Firestore!`);
                }
            }
            console.log("Prompt data loaded successfully.");
        } catch (error) {
            console.error("Error loading prompt data: ", error);
            alert("データの読み込み中にエラーが発生しました。コンソールを確認してください。");
        }
    }

    promptForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        saveStatusP.textContent = '保存中...';
        saveStatusP.className = 'status-message';
        saveButton.disabled = true;

        try {
            const batch = db.batch();
            for (const [docId, fieldIds] of Object.entries(docFieldIds)) {
                const dataToSave = {};
                fieldIds.forEach(fieldId => {
                    const element = document.getElementById(fieldId);
                    if (element) {
                        dataToSave[fieldId] = element.value;
                    }
                });
                const docRef = db.collection('prompts').doc(docId);
                batch.set(docRef, dataToSave, { merge: true });
            }
            await batch.commit();
            saveStatusP.textContent = '正常に保存されました！';
            saveStatusP.classList.add('success');
        } catch (error) {
            console.error("Error saving data: ", error);
            saveStatusP.textContent = '保存に失敗しました。コンソールを確認してください。';
            saveStatusP.classList.add('error');
        }

        saveButton.disabled = false;
        setTimeout(() => {
            saveStatusP.textContent = '';
            saveStatusP.className = 'status-message';
        }, 4000);
    });

});
