import Database from "@tauri-apps/plugin-sql";

const MODE = {
    EXAMPLE: "example",
    NOUN: "noun",
    VERB: "verb",
    GENERATE: "gen",
    FAVORITE: "fav",
};

const MODE_EXECUTE = {
    [MODE.EXAMPLE]: executeDecorator(getExampleSentences),
    [MODE.NOUN]: executeDecorator(getFavoriteWords),
    [MODE.VERB]: executeDecorator(getFavoriteWords),
    [MODE.GENERATE]: executeDecorator(generateSentences),
    [MODE.FAVORITE]: executeDecorator(getFavoriteSentences),
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
}

class App extends LongPressManager {
    #mode;
    #page;
    #btn;

    constructor(longPressElement) {
        super(longPressElement);
        this.#mode = null;
        this.#page = 1;
        this.#btn = null;
    }

    get mode() {
        return this.#mode;
    }

    set mode(mode) {
        if (!Object.values(MODE).includes(mode)) return;
        this.#mode = mode;
        this.#page = 1;
        if (!this.isLongPressed) this.#btn = null;
        this.fire("modeChange", { mode: mode, page: this.page, btn: this.btn });
    }

    get page() {
        return this.#page;
    }

    set page(page) {
        this.#page = Number(page);
        this.fire("pageChange", { page: page, mode: this.mode, btn: this.btn });
    }

    get btn() {
        return this.#btn;
    }

    set btn(btn) {
        this.#btn = btn;
        if (!btn) return;
        this.fire("btnChange", { btn: btn, mode: this.mode, page: this.page });
    }

    getBtnData(btn) {
        const payload = {};
        for (const key in btn.dataset) payload[key] = btn.dataset[key];
        return payload;
    }

    fire(key, data) {
        let payload = data;
        if (key === "longPress") {
            const btn = data.target;
            if (!btn || btn.tagName !== "BUTTON") return;
            payload = {
                mode: this.mode,
                page: this.page,
                btn: btn,
            };
        }
        super.fire(key, payload);
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

async function getExampleSentences({ mode, page }) {
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
            return `<button class="${action}" data-type="${action}" data-table="${table}" data-word="${word}">${word}</button>`;
        };
        const nounBtn = createWordBtn(noun, "noun", isNounExist);
        const verbBtn = createWordBtn(verb, "verb", isVerbExist);
        const li = document.createElement("li");
        li.innerHTML = `${nounBtn}<span class="particle">を</span>${verbBtn}`;
        fragment.appendChild(li);
    }
    mainList.replaceChildren(fragment);
}

async function getFavoriteSentences({ mode, page }) {
    const sentList = await dbFacadeProxy.getAllSentences();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < sentList.length; i++) {
        const noun = sentList[i].noun || sentList[i][0];
        const verb = sentList[i].verb || sentList[i][1];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${DB.DELETE_SENTENCE}" data-type="${DB.DELETE_SENTENCE}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.prepend(li);
    }
    mainList.replaceChildren(fragment);
}

async function getFavoriteWords({ mode, page }) {
    const words = await dbFacadeProxy.getWordsByPage(mode, page);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < words.length; i++) {
        const word = words[i].word || words[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${DB.DELETE_WORD}" data-type="${DB.DELETE_WORD}" data-table="${mode}" data-word="${word}">${word}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, words.length);
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

async function generateSentences({ mode, page, btn }) {
    if (btn?.dataset?.word && btn?.dataset?.table) {
        await generateSentencesWithWord({ word: btn.dataset.word, table: btn.dataset.table, page });
    } else {
        await generateSentencesWithRandom();
    }
}

async function generateSentencesWithRandom() {
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
        li.innerHTML = `<button class="${detaType}" data-type="${detaType}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.appendChild(li);
    }
    mainList.replaceChildren(fragment);
}

async function generateSentencesWithWord({ mode, page, word, table }) {
    const fetchTable = { noun: "verb", verb: "noun" }[table];
    const words = await dbFacadeProxy.getWordsByPage(fetchTable, page);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < words.length; i++) {
        const w = words[i].word || words[i][0];
        const [noun, verb] = { noun: [word, w], verb: [w, word] }[table];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${DB.SAVE_SENTENCE}" data-type="${DB.SAVE_SENTENCE}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, words.length, { word, table });
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

async function saveWord({ btn, table, word }) {
    await dbFacadeProxy.saveWord(table, word);
    btn.className = btn.dataset.type = DB.DELETE_WORD;
}

async function deleteWord({ btn, table, word }) {
    await dbFacadeProxy.deleteWord(table, word);
    btn.className = btn.dataset.type = DB.SAVE_WORD;
}

async function saveSentence({ btn, noun, verb }) {
    await dbFacadeProxy.saveSentence(noun, verb);
    btn.className = btn.dataset.type = DB.DELETE_SENTENCE;
}

async function deleteSentence({ btn, noun, verb }) {
    await dbFacadeProxy.deleteSentence(noun, verb);
    btn.className = btn.dataset.type = DB.SAVE_SENTENCE;
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
            app.mode = MODE.FAVORITE;
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

function createPager(page, listLength, option = {}) {
    if (!page) return null;
    const pagerLi = document.createElement("li");
    pagerLi.className = "page-btn";
    const setDataset = (btn, targetPage) => {
        btn.dataset.type = "page";
        btn.dataset.args = targetPage;
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
    if (listLength === WORD_LIMIT) {
        const nextBtn = document.createElement("button");
        setDataset(nextBtn, page + 1);
        nextBtn.className = "page-next";
        nextBtn.textContent = "▶";
        pagerLi.appendChild(nextBtn);
    }
    return pagerLi.hasChildNodes() ? pagerLi : null;
}

const SENT_LIMIT = 100;
const WORD_LIMIT = 50;

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
        await dbFacadeProxy.init(DB);
    } catch (error) {
        console.error(error);
        resultArea.innerHTML = `<p>データベースの接続に失敗しました：${error}</p>`;
        return;
    }

    app = new App(mainList);

    registerBtn.addEventListener("click", DB_EXECUTE[DB.REGISTER]);

    modeBox.addEventListener("click", (e) => {
        app.mode = e.target.dataset.args;
    });

    mainList.addEventListener("click", (e) => {
        const btn = e.target;
        if (btn.tagName !== "BUTTON") return;
        app.btn = btn;
        if (btn.dataset.type === "page") {
            app.page = Number(btn.dataset.args);
        }
    });

    app.on("modeChange", async ({ mode, page, btn }) => {
        const modeBtn = document.getElementById(`${mode}Btn`);
        if (modeBtn) {
            const buttons = modeBox.querySelectorAll("button");
            buttons.forEach((button) => button.classList.remove("active"));
            modeBtn.classList.add("active");
        }
        mainList.className = `${mode}-list`;
        mainList.innerHTML = "";
        await MODE_EXECUTE[mode]({ mode, page, btn });
        resultArea.scrollTo(0, 0);
    });

    app.on("pageChange", async ({ mode, page, btn }) => {
        await MODE_EXECUTE[mode]({ mode, page, btn });
        resultArea.scrollTo(0, 0);
    });

    app.on("btnChange", ({ btn, mode, page }) => {
        if (!Object.values(DB).includes(btn.dataset.type)) return;
        let dataset = app.getBtnData(btn);
        dataset.btn = btn;
        DB_EXECUTE[dataset.type]?.(dataset);
    });

    app.on("longPress", ({ mode, page, btn }) => {
        if (mode === MODE.NOUN || mode === MODE.VERB) {
            app.btn = btn;
            app.mode = MODE.GENERATE;
        }
    });

    app.mode = MODE.EXAMPLE;
});
