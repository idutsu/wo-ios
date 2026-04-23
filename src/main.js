import Database from "@tauri-apps/plugin-sql";

const MODE = {
    EXAMPLE: "example",
    NOUN: "noun",
    VERB: "verb",
    SENT: "sent",
    GENERATE_WITH_RANDOM: "gen-rand",
    GENERATE_WITH_WORD: "gen-word",
    SEARCH: "search",
};

const MODE_EXECUTE = {
    [MODE.EXAMPLE]: executeDecorator(getExampleSentences),
    [MODE.NOUN]: executeDecorator(getFavoriteWords),
    [MODE.VERB]: executeDecorator(getFavoriteWords),
    [MODE.SENT]: executeDecorator(getFavoriteSentences),
    [MODE.GENERATE_WITH_RANDOM]: executeDecorator(generateSentencesWithRandom),
    [MODE.GENERATE_WITH_WORD]: executeDecorator(generateSentencesWithWord),
    [MODE.SEARCH]: executeDecorator(searchWord),
};

const DB = {
    DELETE_SENTENCE: "delete-sent-btn",
    SAVE_SENTENCE: "save-sent-btn",
    DELETE_WORD: "delete-word-btn",
    SAVE_WORD: "save-word-btn",
    REGISTER: "register-btn",
};

const DB_EXECUTE = {
    [DB.DELETE_SENTENCE]: executeDecorator(deleteSentence),
    [DB.SAVE_SENTENCE]: executeDecorator(saveSentence),
    [DB.DELETE_WORD]: executeDecorator(deleteWord),
    [DB.SAVE_WORD]: executeDecorator(saveWord),
    [DB.REGISTER]: executeDecorator(registerWordOrSentence),
};

class EventManager {
    constructor() {
        this.listeners = {};
    }
    on(key, fn) {
        if (!this.listeners[key]) this.listeners[key] = [];
        this.listeners[key].push(fn);
    }
    fire(key, data) {
        if (this.listeners[key]) {
            this.listeners[key].forEach((fn) => fn(data));
        }
    }
}

class LongPressManager extends EventManager {
    #element;
    #longPressTimer;
    isLongPressed;

    constructor(element) {
        super();
        this.#element = element;
        this.#longPressTimer = null;
        this.isLongPressed = false;
        element.addEventListener("touchstart", this.startLongPress.bind(this));
        element.addEventListener("touchend", this.stopLongPress.bind(this));
        element.addEventListener("touchcancel", this.stopLongPress.bind(this));
        element.addEventListener("touchmove", this.stopLongPress.bind(this));
        element.addEventListener("click", this.preventClick.bind(this), { capture: true });
        element.addEventListener("contextmenu", this.rightClick.bind(this));
    }

    preventClick(e) {
        if (this.isLongPressed) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.isLongPressed = false;
        }
    }

    startLongPress(e) {
        this.isLongPressed = false;
        this.#longPressTimer = setTimeout(() => {
            this.isLongPressed = true;
            this.fire("longPress", e);
        }, 500);
    }

    stopLongPress() {
        if (this.#longPressTimer) {
            clearTimeout(this.#longPressTimer);
            this.#longPressTimer = null;
        }
    }

    rightClick(e) {
        e.preventDefault();
        this.fire("longPress", e);
    }
}

class App extends LongPressManager {
    #mode;
    #page;
    #args;

    constructor(longPressElement) {
        super(longPressElement);
        this.#mode = null;
        this.#page = 1;
        this.#args = null;
    }

    get mode() {
        return this.#mode;
    }

    set mode(mode) {
        if (!Object.values(MODE).includes(mode)) return;
        this.#mode = mode;
        this.#page = 1;
        this.fire("modeChange", { mode: mode, page: this.page, args: this.args });
    }

    get page() {
        return this.#page;
    }

    set page(page) {
        this.#page = Number(page);
        this.fire("pageChange", { mode: this.mode, page: this.page, args: this.args });
    }

    get args() {
        return this.#args;
    }

    set args(data) {
        this.#args = data;
        if (data && Object.values(DB).includes(data.type) && !data.isLongPress) {
            this.fire("btnChange", { mode: this.mode, page: this.page, args: this.args });
        }
    }
}

function executeDecorator(fn) {
    return async function (...args) {
        disableAllButtons();
        try {
            return await fn?.(...args);
        } catch (error) {
            console.error(error);
        } finally {
            enableAllButtons();
        }
    };
}

const dbFacade = {
    db: null,

    async init(dbPath) {
        this.db = await Database.load(dbPath);
    },

    async getRandomExampleSentences(limit = SENT_LIMIT) {
        const query = `
            SELECT noun, verb FROM (
                SELECT noun, verb FROM wo_sudachi_normal
                UNION ALL
                SELECT noun, verb FROM wo_sudachi_sahen
            )
            ORDER BY RANDOM()
            LIMIT ${limit}
        `;
        return await this.db.select(query);
    },

    async getAllWords(table) {
        return await this.db.select(`SELECT word FROM ${table} ORDER BY rowid DESC`);
    },

    async getWordsByPage(table, page = 1, limit = WORD_LIMIT) {
        const safePage = Math.max(1, page);
        const offset = (safePage - 1) * limit;
        return await this.db.select(`SELECT word FROM ${table} ORDER BY rowid DESC LIMIT $1 OFFSET $2`, [
            limit,
            offset,
        ]);
    },

    async getRandomWords(table, limit = SENT_LIMIT) {
        return await this.db.select(`SELECT word FROM ${table} ORDER BY RANDOM() LIMIT ${limit}`);
    },

    async getAllSentences() {
        return await this.db.select("SELECT noun, verb FROM sent");
    },

    async saveWord(table, word) {
        await this.db.execute(`INSERT OR IGNORE INTO ${table} (word) VALUES ($1)`, [word]);
    },

    async deleteWord(table, word) {
        await this.db.execute(`DELETE FROM ${table} WHERE word = $1`, [word]);
    },

    async saveSentence(noun, verb) {
        await this.db.execute(`INSERT OR IGNORE INTO sent (noun, verb) VALUES ($1, $2)`, [noun, verb]);
    },

    async deleteSentence(noun, verb) {
        await this.db.execute(`DELETE FROM sent WHERE noun = $1 AND verb = $2`, [noun, verb]);
    },

    async searchWord(targetColumn, searchColumn, word, page = 1, limit = WORD_LIMIT) {
        const safePage = Math.max(1, page);
        const offset = (safePage - 1) * limit;
        const query = `
                SELECT ${targetColumn} AS word FROM wo_sudachi_normal WHERE ${searchColumn} = $1
                UNION
                SELECT ${targetColumn} AS word FROM wo_sudachi_sahen WHERE ${searchColumn} = $1
                ORDER BY word ASC
                LIMIT $2 OFFSET $3
            `;
        return await this.db.select(query, [word, limit, offset]);
    },
};

function dbProxy(targetDB) {
    const cache = {};

    return new Proxy(targetDB, {
        get: function (target, prop) {
            if (prop === "getAllWords" || prop === "getAllSentences") {
                return async function (table = "sent") {
                    const cacheKey = table;
                    if (cache[cacheKey]) {
                        return cache[cacheKey];
                    }
                    const result = await target[prop](table);
                    cache[table] = result;
                    return result;
                };
            }

            if (prop === "saveWord" || prop === "deleteWord") {
                return async function (...args) {
                    const table = args[0];
                    delete cache[table];
                    const result = await target[prop](...args);
                    return result;
                };
            }

            if (prop === "saveSentence" || prop === "deleteSentence") {
                return async function (...args) {
                    delete cache["sent"];
                    const result = await target[prop](...args);
                    return result;
                };
            }

            return target[prop];
        },
    });
}

const dbFacadeProxy = dbProxy(dbFacade);

async function getExampleSentences({ mode, page, args }) {
    mainList.innerHTML = "<p>読み込み中・・・</p>";
    const rows = await dbFacadeProxy.getRandomExampleSentences(SENT_LIMIT);
    const allNouns = await dbFacadeProxy.getAllWords("noun");
    const allVerbs = await dbFacadeProxy.getAllWords("verb");
    const nounSet = new Set(allNouns.map((n) => n.word || n[0]));
    const verbSet = new Set(allVerbs.map((v) => v.word || v[0]));
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
        const noun = row.noun || row[0];
        const verb = row.verb || row[1];
        if (!noun || !verb) continue;
        const isNounExist = nounSet.has(noun);
        const isVerbExist = verbSet.has(verb);
        const createWordBtn = (word, table, isExist) => {
            const action = isExist ? DB.DELETE_WORD : DB.SAVE_WORD;
            const currentId = `btn-${btnIdCounter++}`;
            const safeWord = escapeHTML(word);
            return `<button id="${currentId}" class="${action}" data-type="${action}" data-id="${currentId}" data-table="${table}" data-word="${safeWord}">${safeWord}</button>`;
        };
        const nounBtn = createWordBtn(noun, "noun", isNounExist);
        const verbBtn = createWordBtn(verb, "verb", isVerbExist);
        const li = document.createElement("li");
        li.innerHTML = `${nounBtn}<span class="particle">を</span>${verbBtn}`;
        fragment.appendChild(li);
    }
    mainList.replaceChildren(fragment);
}

async function getFavoriteSentences({ mode, page, args }) {
    const sentList = await dbFacadeProxy.getAllSentences();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < sentList.length; i++) {
        const noun = sentList[i].noun || sentList[i][0];
        const verb = sentList[i].verb || sentList[i][1];
        const li = document.createElement("li");
        const currentId = `btn-${btnIdCounter++}`;
        const safeNoun = escapeHTML(noun);
        const safeVerb = escapeHTML(verb);
        li.innerHTML = `<button id="${currentId}" class="${DB.DELETE_SENTENCE}" data-type="${DB.DELETE_SENTENCE}" data-id="${currentId}" data-table="sent" data-noun="${safeNoun}" data-verb="${safeVerb}">${safeNoun}を${safeVerb}</button>`;
        fragment.prepend(li);
    }
    mainList.replaceChildren(fragment);
}

async function getFavoriteWords({ mode, page, args }) {
    const words = await dbFacadeProxy.getWordsByPage(mode, page);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < words.length; i++) {
        const word = words[i].word || words[i][0];
        const li = document.createElement("li");
        const currentId = `btn-${btnIdCounter++}`;
        const safeWord = escapeHTML(word);
        li.innerHTML = `<button id="${currentId}" class="${DB.DELETE_WORD}" data-type="${DB.DELETE_WORD}" data-id="${currentId}" data-table="${mode}" data-word="${safeWord}">${safeWord}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, words.length, WORD_LIMIT);
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

async function generateSentencesWithRandom({ mode, page, args }) {
    const nounList = await dbFacadeProxy.getRandomWords("noun", SENT_LIMIT);
    const verbList = await dbFacadeProxy.getRandomWords("verb", SENT_LIMIT);
    const allSentences = await dbFacadeProxy.getAllSentences();
    const sentSet = new Set(
        allSentences.map((s) => {
            const n = s.noun || s[0];
            const v = s.verb || s[1];
            return `${n}_${v}`;
        }),
    );
    const loopCount = Math.min(nounList.length, verbList.length, SENT_LIMIT);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < loopCount; i++) {
        const noun = nounList[i].word || nounList[i][0];
        const verb = verbList[i].word || verbList[i][0];
        const isSentExist = sentSet.has(`${noun}_${verb}`);
        const detaType = isSentExist ? DB.DELETE_SENTENCE : DB.SAVE_SENTENCE;
        const li = document.createElement("li");
        const currentId = `btn-${btnIdCounter++}`;
        const safeNoun = escapeHTML(noun);
        const safeVerb = escapeHTML(verb);
        li.innerHTML = `<button id="${currentId}" class="${detaType}" data-type="${detaType}" data-id="${currentId}" data-table="sent" data-noun="${safeNoun}" data-verb="${safeVerb}">${safeNoun}を${safeVerb}</button>`;
        fragment.appendChild(li);
    }
    mainList.replaceChildren(fragment);
}

async function generateSentencesWithWord({ mode, page, args }) {
    const table = args.table;
    const word = args.word;
    const fetchTable = { noun: "verb", verb: "noun" }[table];
    const words = await dbFacadeProxy.getWordsByPage(fetchTable, page);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < words.length; i++) {
        const w = words[i].word || words[i][0];
        const [noun, verb] = { noun: [word, w], verb: [w, word] }[table];
        const li = document.createElement("li");
        const currentId = `btn-${btnIdCounter++}`;
        const safeNoun = escapeHTML(noun);
        const safeVerb = escapeHTML(verb);
        li.innerHTML = `<button id="${currentId}" class="${DB.SAVE_SENTENCE}" data-type="${DB.SAVE_SENTENCE}" data-id="${currentId}" data-table="sent" data-noun="${safeNoun}" data-verb="${safeVerb}">${safeNoun}を${safeVerb}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, words.length, WORD_LIMIT, { table, word });
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

async function searchWord({ mode, page, args }) {
    const nounText = args?.noun;
    const verbText = args?.verb;
    if (!nounText && !verbText) return;
    try {
        let words, table;
        if (nounText && !verbText) {
            words = await dbFacadeProxy.searchWord("verb", "noun", nounText, page);
            table = "verb";
        } else if (!nounText && verbText) {
            words = await dbFacadeProxy.searchWord("noun", "verb", verbText, page);
            table = "noun";
        }
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < words.length; i++) {
            const word = words[i].word;
            const li = document.createElement("li");
            const currentId = `btn-${btnIdCounter++}`;
            const safeWord = escapeHTML(word);
            li.innerHTML = `<button id="${currentId}" class="${DB.DELETE_WORD}" data-type="${DB.DELETE_WORD}" data-id="${currentId}" data-table="${table}" data-word="${safeWord}">${safeWord}</button>`;
            fragment.append(li);
        }
        const pager = createPager(page, words.length, WORD_LIMIT, { noun: nounText, verb: verbText });
        if (pager) fragment.append(pager);
        mainList.replaceChildren(fragment);
    } catch (error) {
        console.error(error);
    }
}

async function saveWord({ id, table, word }) {
    await dbFacadeProxy.saveWord(table, word);
    const btn = document.getElementById(id);
    if (btn) btn.className = btn.dataset.type = DB.DELETE_WORD;
}

async function deleteWord({ id, table, word }) {
    await dbFacadeProxy.deleteWord(table, word);
    const btn = document.getElementById(id);
    if (btn) btn.className = btn.dataset.type = DB.SAVE_WORD;
}

async function saveSentence({ id, noun, verb }) {
    await dbFacadeProxy.saveSentence(noun, verb);
    const btn = document.getElementById(id);
    if (btn) btn.className = btn.dataset.type = DB.DELETE_SENTENCE;
}

async function deleteSentence({ id, noun, verb }) {
    await dbFacadeProxy.deleteSentence(noun, verb);
    const btn = document.getElementById(id);
    if (btn) btn.className = btn.dataset.type = DB.SAVE_SENTENCE;
}

async function registerWordOrSentence() {
    const nounText = nounInput.value.trim();
    const verbText = verbInput.value.trim();
    if (!nounText && !verbText) return;
    try {
        if (nounText && !verbText) {
            await dbFacadeProxy.saveWord("noun", nounText);
            nounInput.value = "";
            app.mode = MODE.NOUN;
        } else if (!nounText && verbText) {
            await dbFacadeProxy.saveWord("verb", verbText);
            verbInput.value = "";
            app.mode = MODE.VERB;
        } else {
            await dbFacadeProxy.saveSentence(nounText, verbText);
            nounInput.value = "";
            verbInput.value = "";
            app.mode = MODE.SENT;
        }
    } catch (error) {
        console.error(error);
    }
}

function disableAllButtons() {
    const buttons = document.querySelectorAll("button");
    buttons.forEach((btn) => {
        btn.disabled = true;
    });
}

function enableAllButtons() {
    const buttons = document.querySelectorAll("button");
    buttons.forEach((btn) => {
        btn.disabled = false;
    });
}

function createPager(page = 1, listLength, limit, option = {}) {
    const pagerLi = document.createElement("li");
    pagerLi.className = "pager";
    const setDataset = (btn, targetPage) => {
        btn.dataset.page = targetPage;
        for (const [key, value] of Object.entries(option)) {
            if (value !== undefined) btn.dataset[key] = value;
        }
    };
    if (page > 1) {
        const prevBtn = document.createElement("button");
        setDataset(prevBtn, page - 1);
        prevBtn.className = "page-prev";
        prevBtn.textContent = "◀";
        pagerLi.appendChild(prevBtn);
    }
    if (listLength === limit) {
        const nextBtn = document.createElement("button");
        setDataset(nextBtn, page + 1);
        nextBtn.className = "page-next";
        nextBtn.textContent = "▶";
        pagerLi.appendChild(nextBtn);
    }
    return pagerLi.hasChildNodes() ? pagerLi : null;
}

function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(
        /[&<>"']/g,
        (match) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[match],
    );
}

const SENT_LIMIT = 100;
const WORD_LIMIT = 50;

let app;
let modeBox = null;
let mainList = null;
let nounBtn = null;
let verbBtn = null;
let genBtn = null;
let sentBtn = null;
let exampleBtn = null;
let searchBtn = null;
let nounInput = null;
let verbInput = null;
let registerBtn = null;
let resultArea = null;
let btnIdCounter = 0;

window.addEventListener("DOMContentLoaded", async () => {
    resultArea = document.getElementById("resultArea");
    modeBox = document.getElementById("modeBox");
    mainList = document.getElementById("mainList");
    exampleBtn = document.getElementById(`${MODE.EXAMPLE}Btn`);
    nounBtn = document.getElementById(`${MODE.NOUN}Btn`);
    verbBtn = document.getElementById(`${MODE.VERB}Btn`);
    genBtn = document.getElementById(`${MODE.GENERATE_WITH_RANDOM}Btn`);
    sentBtn = document.getElementById(`${MODE.SENT}Btn`);
    searchBtn = document.getElementById(`${MODE.SEARCH}Btn`);
    registerBtn = document.getElementById("registerBtn");
    nounInput = document.getElementById("registerNounInput");
    verbInput = document.getElementById("registerVerbInput");

    try {
        const DB = import.meta.env.VITE_DB;
        await dbFacadeProxy.init(DB);
    } catch (error) {
        console.error(error);
        resultArea.innerHTML = `<p>データベースの接続に失敗しました：${error}</p>`;
        return;
    }

    app = new App(mainList);

    nounBtn.addEventListener("click", () => (app.mode = MODE.NOUN));
    verbBtn.addEventListener("click", () => (app.mode = MODE.VERB));
    genBtn.addEventListener("click", () => (app.mode = MODE.GENERATE_WITH_RANDOM));
    sentBtn.addEventListener("click", () => (app.mode = MODE.SENT));
    exampleBtn.addEventListener("click", () => (app.mode = MODE.EXAMPLE));

    searchBtn.addEventListener("click", () => {
        app.args = {
            noun: nounInput.value.trim(),
            verb: verbInput.value.trim(),
        };
        app.mode = MODE.SEARCH;
    });

    registerBtn.addEventListener("click", DB_EXECUTE[DB.REGISTER]);

    mainList.addEventListener("click", (e) => {
        const btn = e.target;
        if (btn.tagName !== "BUTTON") return;
        if (btn.dataset.page) {
            app.page = Number(btn.dataset.page);
        } else {
            app.args = { ...btn.dataset };
        }
    });

    app.on("modeChange", async ({ mode, page, args }) => {
        const modeBtn = document.getElementById(`${mode}Btn`);
        if (modeBtn) {
            const buttons = modeBox.querySelectorAll("button");
            buttons.forEach((button) => button.classList.remove("active"));
            modeBtn.classList.add("active");
        }
        mainList.className = `${mode}-list`;
        mainList.innerHTML = "";
        btnIdCounter = 0;
        await MODE_EXECUTE[mode]({ mode, page, args });
        resultArea.scrollTo(0, 0);
    });

    app.on("pageChange", async ({ mode, page, args }) => {
        await MODE_EXECUTE[mode]({ mode, page, args });
        resultArea.scrollTo(0, 0);
    });

    app.on("btnChange", ({ mode, page, args }) => {
        DB_EXECUTE[args.type]?.(args);
    });

    app.on("longPress", (e) => {
        const btn = e.target;
        if (btn.tagName !== "BUTTON") return;
        if (app.mode === MODE.NOUN || app.mode === MODE.VERB || app.mode === MODE.SEARCH) {
            app.args = { ...btn.dataset, isLongPress: true };
            app.mode = MODE.GENERATE_WITH_WORD;
        }
    });

    app.mode = MODE.EXAMPLE;
});
