import Database from "@tauri-apps/plugin-sql";

const MODE = {
    EXAMPLE  : "example",
    NOUN     : "noun",
    VERB     : "verb",
    GENERATE : "gen",
    FAVORITE : "fav",
};

const MODE_EXECUTE = {
    [MODE.EXAMPLE]  : getExampleSentences,
    [MODE.NOUN]     : getFavoriteWords,
    [MODE.VERB]     : getFavoriteWords,
    [MODE.GENERATE] : generateSentences,
    [MODE.FAVORITE] : getFavoriteSentences,
};

const BUTTON = {
    DELETE_SENTENCE : "delete-sent-btn",
    SAVE_SENTENCE   : "save-sent-btn",
    DELETE_WORD     : "delete-word-btn",
    SAVE_WORD       : "save-word-btn",
};

const BUTTON_EXECUTE = {
    [BUTTON.DELETE_SENTENCE] : deleteSentence,
    [BUTTON.SAVE_SENTENCE]   : saveSentence,
    [BUTTON.DELETE_WORD]     : deleteWord,
    [BUTTON.SAVE_WORD]       : saveWord,
};

const CONTEXT = {
    GEN_WITH_NOUN : "gen-with-noun",
    GEN_WITH_VERB : "gen-with-verb",
}

const CONTEXT_EXECUTE = {
    [CONTEXT.GEN_WITH_NOUN] : generateSentencesWithNoun,
    [CONTEXT.GEN_WITH_VERB] : generateSentencesWithVerb,
}

class App {
    #mode;

    constructor() {
        this.#mode = null;
    }

    get mode() {
        return this.#mode;
    }

    async tapButton(btn) {
        const { type, table, noun, verb, word } = btn.dataset || {};

        try {
            await BUTTON_EXECUTE[type]?.({ btn, table, word, noun, verb });
        } catch (error) {
            console.error(error);
        }
    }

    async tapContext(btn) {
        const { context, table, noun, verb, word } = btn.dataset || {};

        try {
            await CONTEXT_EXECUTE[context]?.({btn, word});
        } catch (error) {
            console.error(error);
        }
    }

    async changeMode(mode) {
        this.#mode = mode;

        mainList.className = mode + "-list";
        mainList.innerHTML = "";

        const btn = document.getElementById(mode + "Btn");
        if (btn) {
            const buttons = modeBox.querySelectorAll("button");
            buttons.forEach((button) => {
                button.disabled = true;
                button.classList.remove("active");
            });
            btn.classList.add("active");
        }

        try {
            await MODE_EXECUTE[mode]?.(mode);
        } catch (error) {
            console.error(error);
        } finally {
            enableAllButtons();
        }
    }
}

async function getExampleSentences() {
    mainList.innerHTML = "<p>読み込み中・・・</p>";

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

        const nounBtn = isNounExist
            ? `<button class="${BUTTON.DELETE_WORD}" data-type="${BUTTON.DELETE_WORD}" data-table="noun" data-word="${noun}">${noun}</button>`
            : `<button class="${BUTTON.SAVE_WORD}" data-type="${BUTTON.SAVE_WORD}" data-table="noun" data-word="${noun}">${noun}</button>`;
        const verbBtn = isVerbExist
            ? `<button class="${BUTTON.DELETE_WORD}" data-type="${BUTTON.DELETE_WORD}" data-table="verb" data-word="${verb}">${verb}</button>`
            : `<button class="${BUTTON.SAVE_WORD}" data-type="${BUTTON.SAVE_WORD}" data-table="verb" data-word="${verb}">${verb}</button>`;

        const li = document.createElement("li");
        li.innerHTML = `${nounBtn}<span class="particle">を</span>${verbBtn}`;
        fragment.appendChild(li);
    }

    mainList.innerHTML = "";
    mainList.appendChild(fragment);
}

async function getFavoriteSentences() {
    mainList.innerHTML = "";

    const sentList = await db.select("SELECT noun, verb FROM sent");
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < sentList.length; i++) {
        const noun = sentList[i].noun || sentList[i][0];
        const verb = sentList[i].verb || sentList[i][1];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.DELETE_SENTENCE}" data-type="${BUTTON.DELETE_SENTENCE}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.prepend(li);
    }
    mainList.appendChild(fragment);
}

async function getFavoriteWords(mode) {
    const wordList = await db.select(`SELECT word FROM ${mode}`);
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < wordList.length; i++) {
        const word = wordList[i].word || wordList[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.DELETE_WORD}" data-type="${BUTTON.DELETE_WORD}" data-context="${mode === MODE.NOUN ? "gen-with-noun" : "gen-with-verb"}" data-table="${mode}" data-word="${word}">${word}</button>`;
        fragment.prepend(li);
    }

    mainList.appendChild(fragment);
}

async function generateSentences(mode) {
    const getLimit = 300;

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
        const sentBtnClass = isSentExist ? BUTTON.DELETE_SENTENCE : BUTTON.SAVE_SENTENCE;

        const li = document.createElement("li");
        li.innerHTML = `<button class="${sentBtnClass}" data-type="${sentBtnClass}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;

        fragment.appendChild(li);
    }

    mainList.appendChild(fragment);
}

async function generateSentencesWithNoun({btn, word}) {
    mainList.className = "gen-list";
    mainList.innerHTML = "";
    const wordList = await db.select(`SELECT word FROM verb`);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < wordList.length; i++) {
        const w = wordList[i].word || wordList[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.SAVE_SENTENCE}" data-type="${BUTTON.SAVE_SENTENCE}" data-table="sent" data-noun="${word}" data-verb="${w}">${word}を${w}</button>`;
        fragment.prepend(li);
    }
    mainList.prepend(fragment);
}

async function generateSentencesWithVerb({btn, word}) {
    mainList.className = "gen-list";
    mainList.innerHTML = "";
    const wordList = await db.select(`SELECT word FROM noun`);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < wordList.length; i++) {
        const w = wordList[i].word || wordList[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.SAVE_SENTENCE}" data-type="${BUTTON.SAVE_SENTENCE}" data-table="sent" data-noun="${w}" data-verb="${word}">${w}を${word}</button>`;
        fragment.prepend(li);
    }
    mainList.prepend(fragment);

}

async function saveWord({ btn, table, word }) {
    await db.execute(`INSERT OR IGNORE INTO ${table} (word) VALUES ($1)`, [word]);
    btn.className = btn.dataset.type = BUTTON.DELETE_WORD;
}

async function deleteWord({ btn, table, word }) {
    await db.execute(`DELETE FROM ${table} WHERE word = $1`, [word]);
    btn.className = btn.dataset.type = BUTTON.SAVE_WORD;
}

async function saveSentence({ btn, noun, verb }) {
    await db.execute(`INSERT OR IGNORE INTO sent (noun, verb) VALUES ($1, $2)`, [noun, verb]);
    btn.className = btn.dataset.type = BUTTON.DELETE_SENTENCE;
}

async function deleteSentence({ btn, noun, verb }) {
    await db.execute(`DELETE FROM sent WHERE noun = $1 AND verb = $2`, [noun, verb]);
    btn.className = btn.dataset.type = BUTTON.SAVE_SENTENCE;
}

const register = async (e) => {
    const nounText = nounInput.value.trim();
    const verbText = verbInput.value.trim();

    if (!nounText && !verbText) return;

    try {
        if (nounText && !verbText) {
            await db.execute(`INSERT OR IGNORE INTO noun (word) VALUES ($1)`, [nounText]);
            nounInput.value = "";
            nounBtn.click();
        } else if (!nounText && verbText) {
            await db.execute(`INSERT OR IGNORE INTO verb (word) VALUES ($1)`, [verbText]);
            verbInput.value = "";
            verbBtn.click();
        } else {
            await db.execute(`INSERT OR IGNORE INTO sent (noun, verb) VALUES ($1, $2)`, [nounText, verbText]);
            nounInput.value = "";
            verbInput.value = "";
            favBtn.click();
        }
    } catch (error) {
        console.error(error);
    }
};

const searchInputWords = (e) => {
    if (app.mode === MODE.NOUN || app.mode === MODE.VERB) {
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

function enableAllButtons() {
    const buttons = modeBox.querySelectorAll("button");
    buttons.forEach((button) => {
        button.disabled = false;
    });
}

const startPress = (e) => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
        if (!pressFlag) return;
        pressFlag = false;
        if (e.target.tagName !== "BUTTON") return;
        if (!e.target.dataset.context) return;
        app.tapContext(e.target);
    }, 500);
};

const cancelPress = () => {
    pressFlag = true;
    clearTimeout(pressTimer);
};

const cancelPressFlag = (e) => {
    if (pressFlag) pressFlag = false;
};

let db;
let app;
let modeBox = null;
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
    modeBox = document.getElementById("modeBox");
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
        console.error(error);
        resultArea.innerHTML = `<p>データベースの接続に失敗しました：${error}</p>`;
    }

    exampleBtn.addEventListener("click", () => app.changeMode(MODE.EXAMPLE));
    genBtn.addEventListener("click", () => app.changeMode(MODE.GENERATE));
    favBtn.addEventListener("click", () => app.changeMode(MODE.FAVORITE));
    nounBtn.addEventListener("click", () => app.changeMode(MODE.NOUN));
    verbBtn.addEventListener("click", () => app.changeMode(MODE.VERB));

    nounInput.addEventListener("focus", () => nounBtn.click());
    verbInput.addEventListener("focus", () => verbBtn.click());
    nounInput.addEventListener("input", searchInputWords);
    verbInput.addEventListener("input", searchInputWords);
    registerBtn.addEventListener("click", register);

    mainList.addEventListener("click", (e) => {
        if (e.target.tagName !== "BUTTON") return;
        app.tapButton(e.target);
    });

    mainList.addEventListener("touchstart", startPress);
    mainList.addEventListener("touchend", cancelPress);
    mainList.addEventListener("touchcancel", cancelPress);
    mainList.addEventListener("touchmove", cancelPressFlag);

    app = new App();
    exampleBtn.click();
});
