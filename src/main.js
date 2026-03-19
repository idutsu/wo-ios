import Database from "@tauri-apps/plugin-sql";

const MODE = {
    EXAMPLE       : "example",
    NOUN          : "noun",
    VERB          : "verb",
    GENERATE      : "gen",
    GENERATE_WITH : "genWith",
    FAVORITE      : "fav",
}

const EXECUTE = {
    [MODE.EXAMPLE]  : getExampleSentences,
    [MODE.NOUN]     : getFavoriteWords,
    [MODE.VERB]     : getFavoriteWords,
    [MODE.GENERATE] : generateSentences,
    [MODE.GENERATE_WITH] : generateSentencesWithWord,
    [MODE.FAVORITE] : getFavoriteSentences,
}

class State {
    #mode;
    #btn;

    constructor() {
        this.#mode = null;
        this.#btn = null;
    }

    get btn() {
        return this.#btn.deref();
    }

    set btn(btn) {
        this.#btn = new WeakRef(btn);
    }

    get mode() {
        return this.#mode;
    }

    set mode(mode) {
        this.#mode = mode;
        this.#update(mode);
    }

    #update(mode) {
        const buttons = document.getElementById("btnBox").querySelectorAll("button");
        mainList.className = mode + "-list";
        mainList.innerHTML = "";
        const btn = document.getElementById(mode + "Btn");
        if (btn) {
            buttons.forEach((button) => {
                button.disabled = true;
                button.classList.remove("active");
            });
            btn.classList.add("active");
        }
        EXECUTE[mode](mode);
    }
}

//WIKIPEDIAからランダムに文を取得する
async function getExampleSentences() {

    mainList.innerHTML = "<p>読み込み中・・・</p>";

    try {
        const query = `
            SELECT noun, verb FROM (
                SELECT noun, verb FROM wo_sudachi_normal
                UNION ALL
                SELECT noun, verb FROM wo_sudachi_sahen
            )
            ORDER BY RANDOM()
            LIMIT 300
        `;

        const rows = await db.select(query);

        const allNouns = await db.select("SELECT word FROM noun");
        const allVerbs = await db.select("SELECT word FROM verb");

        const nounSet = new Set(allNouns.map((n) => n.word || n[0]));
        const verbSet = new Set(allVerbs.map((v) => v.word || v[0]));

        const fragment = document.createDocumentFragment();

        for (const row of rows) {
            const noun = row.noun || row[0];
            const verb = row.verb || row[1];

            if (!noun || !verb) continue;

            const isNounExist = nounSet.has(noun);
            const isVerbExist = verbSet.has(verb);

            const nounBtn = isNounExist ? `<button class="delete-word-btn" data-table="noun" data-word="${noun}">${noun}</button>` : `<button class="good-word-btn" data-table="noun" data-word="${noun}">${noun}</button>`;
            const verbBtn = isVerbExist ? `<button class="delete-word-btn" data-table="verb" data-word="${verb}">${verb}</button>` : `<button class="good-word-btn" data-table="verb" data-word="${verb}">${verb}</button>`;

            const li = document.createElement("li");
            li.innerHTML = `${nounBtn}<span class="particle">を</span>${verbBtn}`;

            fragment.appendChild(li);
        }

        mainList.innerHTML = "";
        mainList.appendChild(fragment);
    } catch (error) {
        console.error("例文の取得に失敗しました：", error);
    } finally {
        enableAllButtons();
    }
}

//お気に入り文を取得する
async function getFavoriteSentences() {

    mainList.innerHTML = "";

    try {
        const sentList = await db.select("SELECT noun, verb FROM sent");

        for (let i = 0; i < sentList.length; i++) {
            const noun = sentList[i].noun || sentList[i][0];
            const verb = sentList[i].verb || sentList[i][1];
            const li = document.createElement("li");
            li.innerHTML = `<button class="delete-sent-btn" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
            mainList.prepend(li);
        }
    } catch (error) {
        console.error("お気に入り文の取得に失敗しました：", error);
    } finally {
        enableAllButtons();
    }
}

//お気に入り単語（名詞 OR 動詞）を取得する
async function getFavoriteWords(mode) {

    try {
        const wordList = await db.select(`SELECT word FROM ${mode}`);

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < wordList.length; i++) {
            const word = wordList[i].word || wordList[i][0];
            const li = document.createElement("li");
            li.innerHTML = `<button class="delete-word-btn" data-table="${mode}" data-word="${word}">${word}</button>`;
            fragment.prepend(li);
        }

        mainList.appendChild(fragment);
    } catch (error) {
        console.error("お気に入り単語の取得に失敗しました：", error);
    } finally {
        enableAllButtons();
    }
}

// お気に入り単語（名詞と動詞）から文を生成する
async function generateSentences(mode) {

    const getLimit = 300;

    try {
        const nounList = await db.select(`SELECT word FROM noun ORDER BY RANDOM() LIMIT ${getLimit}`);
        const verbList = await db.select(`SELECT word FROM verb ORDER BY RANDOM() LIMIT ${getLimit}`);

        const allSentences = await db.select("SELECT noun, verb FROM sent");

        const sentSet = new Set(
            allSentences.map((s) => {
                const n = s.noun || s[0];
                const v = s.verb || s[1];
                return `${n}_${v}`;
            }),
        );

        const loopCount = Math.min(nounList.length, verbList.length, getLimit);
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < loopCount; i++) {
            const noun = nounList[i].word || nounList[i][0];
            const verb = verbList[i].word || verbList[i][0];

            const isSentExist = sentSet.has(`${noun}_${verb}`);
            const sentBtnClass = isSentExist ? "delete-sent-btn" : "good-sent-btn";

            const li = document.createElement("li");
            li.innerHTML = `<button class="${sentBtnClass}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;

            fragment.appendChild(li);
        }

        mainList.appendChild(fragment);
    } catch (error) {
        console.error("作文に失敗しました：", error);
    } finally {
        enableAllButtons();
    }
}


//単語（名詞 OR 動詞）を含む文を生成する
async function generateSentencesWithWord() {
    const btn = state.btn;
    const withWord = btn.dataset.word;
    let table;
    let createSentenceHTML;

    if (btn.dataset.table === MODE.NOUN) {
        table = "verb";
        createSentenceHTML = (word) =>
            `<button class="good-sent-btn" data-table="sent" data-noun="${withWord}" data-verb="${word}">${withWord}を${word}</button>`;
    } else {
        table = "noun";
        createSentenceHTML = (word) =>
            `<button class="good-sent-btn" data-table="sent" data-noun="${word}" data-verb="${withWord}">${word}を${withWord}</button>`;
    }

    mainList.className = "gen-list";
    mainList.innerHTML = "";

    try {
        const wordList = await db.select(`SELECT word FROM ${table}`);

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < wordList.length; i++) {
            const word = wordList[i].word || wordList[i][0];
            const li = document.createElement("li");
            li.innerHTML = createSentenceHTML(word);
            fragment.prepend(li);
        }
        mainList.prepend(fragment);
    } catch (error) {
        console.error("単語からの作文に失敗しました：", error);
    } finally {
        enableAllButtons();
    }
}

//単語（名詞 OR 動詞）を保存・削除する
const saveWord = async (e) => {
    if (e.target.classList.contains("good-word-btn")) {
        const btn = e.target;
        const table = btn.dataset.table;
        const wordText = btn.dataset.word.trim();

        if (!wordText) return;

        try {
            await db.execute(`INSERT OR IGNORE INTO ${table} (word) VALUES ('${wordText}')`);
            btn.className = "delete-word-btn";
        } catch (error) {
            console.error("単語の保存に失敗しました：", error);
        }
    } else if (e.target.classList.contains("delete-word-btn")) {
        const btn = e.target;
        const table = btn.dataset.table;
        const wordText = btn.dataset.word.trim();

        if (!wordText) return;

        try {
            await db.select(`DELETE FROM ${table} WHERE word = '${wordText}'`);
            btn.className = "good-word-btn";
        } catch (error) {
            console.error("単語の削除に失敗しました：", error);
        }
    }
};

//文を保存・削除する
const saveSentences = async (e) => {
    if (e.target.classList.contains("good-sent-btn")) {
        const btn = e.target;
        const noun = btn.dataset.noun.trim();
        const verb = btn.dataset.verb.trim();
        try {
            await db.execute(`INSERT OR IGNORE INTO sent (noun, verb) VALUES ('${noun}', '${verb}')`);
            btn.className = "delete-sent-btn";
        } catch (error) {
            console.error("文の保存に失敗しました：", error);
        }
    } else if (e.target.classList.contains("delete-sent-btn")) {
        const btn = e.target;
        const noun = btn.dataset.noun.trim();
        const verb = btn.dataset.verb.trim();
        try {
            await db.select(`DELETE FROM sent WHERE noun = '${noun}' AND verb = '${verb}'`);
            btn.className = "good-sent-btn";
        } catch (error) {
            console.error("文の削除に失敗しました：", error);
        }
    }
};

//入力した名詞・動詞・文を登録する
const register = async (e) => {
    const nounText = nounInput.value.trim();
    const verbText = verbInput.value.trim();

    // 両方空なら即終了（ガード処理）
    if (!nounText && !verbText) return;

    try {
        if (nounText && !verbText) {
            await db.execute(`INSERT OR IGNORE INTO noun (word) VALUES ('${nounText}')`);
            nounInput.value = "";
            nounBtn.click();
        } else if (!nounText && verbText) {
            await db.execute(`INSERT OR IGNORE INTO verb (word) VALUES ('${verbText}')`);
            verbInput.value = "";
            verbBtn.click();
        } else {
            await db.execute(`INSERT OR IGNORE INTO sent (noun, verb) VALUES ('${nounText}', '${verbText}')`);
            nounInput.value = "";
            verbInput.value = "";
            favBtn.click();
        }
    } catch (error) {
        console.error("登録に失敗しました：", error);
    }
};

const searchInputWords = (e) => {
    if (state.mode === MODE.NOUN || state.mode === MODE.VERB) {
        const inputVal = e.target.value.trim();
        const listItems = mainList.querySelectorAll("li");
        listItems.forEach((li) => {
            const btn = li.querySelector("button");
            if (!btn) return;
            const word = btn.getAttribute("data-word");
            if (!word) return;
            if (inputVal === "" || word.includes(inputVal)) {
                li.style.display = "";
            } else {
                li.style.display = "none";
            }
        });
    }
};

function disableAllButtons() {
    const buttons = document.getElementById("btnBox").querySelectorAll("button");
    buttons.forEach((button) => {
        button.disabled = true;
        button.classList.remove("active");
    });
}

function activateButton(btn) {
    btn.classList.add("active");
}

function enableAllButtons() {
    const buttons = document.getElementById("btnBox").querySelectorAll("button");
    buttons.forEach((button) => {
        button.disabled = false;
    });
}

const startPress = (e) => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
        if (pressFlag) {
            pressFlag = false;
            if (state.mode === MODE.NOUN || state.mode === MODE.VERB) {
                if (e.target.tagName !== "BUTTON") return;
                state.btn = e.target;
                state.mode = MODE.GENERATE_WITH;
            }
        }
    }, 500);
};

const cancelPress = () => {
    pressFlag = true;
    clearTimeout(pressTimer);
};

const cancelPressFlag = (e) => {
    if (pressFlag) pressFlag = false;
}

let db;
let state;
let mainList = null;
let nounBtn = null;
let verbBtn = null;
let genBtn = null;
let favBtn = null;
let exampleBtn = null;
let nounInput = null;
let verbInput = null;
let registerBtn = null;
let resultArea = null;
let pressTimer;
let pressFlag = true;

window.addEventListener("DOMContentLoaded", async () => {
    mainList = document.getElementById("mainList");
    nounBtn = document.getElementById("nounBtn");
    verbBtn = document.getElementById("verbBtn");
    nounInput = document.getElementById("registerNounInput");
    verbInput = document.getElementById("registerVerbInput");
    genBtn = document.getElementById("genBtn");
    favBtn = document.getElementById("favBtn");
    exampleBtn = document.getElementById("exampleBtn");
    registerBtn = document.getElementById("registerBtn");
    resultArea = document.getElementById("resultArea");

    try {
        const DB = import.meta.env.VITE_DB;
        db = await Database.load(DB);
    } catch (error) {
        console.error("DB接続失敗:", error);
        resultArea.innerHTML = `<p">データベースの接続に失敗しました：${error}</p>`;
    }

    exampleBtn.addEventListener("click", (e) => state.mode = MODE.EXAMPLE);
    genBtn.addEventListener("click", (e) => state.mode = MODE.GENERATE);
    favBtn.addEventListener("click", (e) => state.mode = MODE.FAVORITE);
    nounBtn.addEventListener("click", (e) => state.mode = MODE.NOUN);
    verbBtn.addEventListener("click", (e) => state.mode = MODE.VERB);
    registerBtn.addEventListener("click", register);
    nounInput.addEventListener("focus", (e) => nounBtn.click());
    verbInput.addEventListener("focus", (e) => verbBtn.click());
    nounInput.addEventListener("input", searchInputWords);
    verbInput.addEventListener("input", searchInputWords);
    mainList.addEventListener("click", saveWord);
    mainList.addEventListener("click", saveSentences);
    mainList.addEventListener('touchstart', startPress);
    mainList.addEventListener('touchend', cancelPress);
    mainList.addEventListener('touchcancel', cancelPress);
    mainList.addEventListener('touchmove', cancelPressFlag);

    state = new State();

    exampleBtn.click();
});
