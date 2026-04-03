import Database from "@tauri-apps/plugin-sql";

const executeDecorator = (fn) => {
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
};

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

const BUTTON = {
    DELETE_SENTENCE: "delete-sent-btn",
    SAVE_SENTENCE: "save-sent-btn",
    DELETE_WORD: "delete-word-btn",
    SAVE_WORD: "save-word-btn",
    REGISTER: "register-btn",
    PAGE: "page-btn",
};

const BUTTON_EXECUTE = {
    [BUTTON.DELETE_SENTENCE]: executeDecorator(deleteSentence),
    [BUTTON.SAVE_SENTENCE]: executeDecorator(saveSentence),
    [BUTTON.DELETE_WORD]: executeDecorator(deleteWord),
    [BUTTON.SAVE_WORD]: executeDecorator(saveWord),
    [BUTTON.REGISTER]: executeDecorator(registerWordOrSentence),
    [BUTTON.PAGE]: executeDecorator(pager),
};

const OPTION = {
    GEN_WITH_WORD: "gen-with-word",
};

const OPTION_EXECUTE = {
    [OPTION.GEN_WITH_WORD]: executeDecorator(generateSentencesWithWord),
};

class App {
    #mode;
    listeners = {};

    constructor() {
        this.#mode = null;
    }

    get mode() {
        return this.#mode;
    }

    async buttonExecute(btn) {
        const payload = { btn };
        for (const key in btn.dataset) payload[key] = btn.dataset[key];
        await BUTTON_EXECUTE[payload.type]?.(payload);
    }

    async optionExecute(btn) {
        const payload = {};
        for (const key in btn.dataset) payload[key] = btn.dataset[key];
        await OPTION_EXECUTE[payload.option]?.(payload);
        resultArea.scrollTo(0, 0);
    }

    async modeExecute(mode) {
        this.#mode = mode;
        mainList.className = `${mode}-list`;
        mainList.innerHTML = "";
        const btn = document.getElementById(`${mode}Btn`);
        if (btn) {
            const buttons = modeBox.querySelectorAll("button");
            buttons.forEach((button) => button.classList.remove("active"));
            btn.classList.add("active");
        }
        await MODE_EXECUTE[mode]?.({ mode, page: 1 });
        resultArea.scrollTo(0, 0);
    }

    addEventListener(key, fn) {
        if (!this.listeners[key]) this.listeners[key] = [];
        this.listeners[key].push(fn);
    }

    fireEventLisner(key, data) {
        if (this.listeners[key]) {
            this.listeners[key].forEach((fn) => fn(data));
        }
    }
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
                        console.log(`${table}はキャッシュを利用します。`);
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
                    console.log(`${table} が更新されました。${table}のキャッシュを削除します。`);
                    delete cache[table];
                    const result = await target[prop](...args);
                    return result;
                };
            }

            if (prop === "saveSentence" || prop === "deleteSentence") {
                return async function (...args) {
                    console.log(`お気に入り文が更新されました。sentのキャッシュを削除します。`);
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

/**
 * @returns {void}
 */
async function getExampleSentences() {
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
            const action = isExist ? BUTTON.DELETE_WORD : BUTTON.SAVE_WORD;
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

/**
 * @returns {void}
 */
async function getFavoriteSentences() {
    const sentList = await dbFacadeProxy.getAllSentences();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < sentList.length; i++) {
        const noun = sentList[i].noun || sentList[i][0];
        const verb = sentList[i].verb || sentList[i][1];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.DELETE_SENTENCE}" data-type="${BUTTON.DELETE_SENTENCE}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.prepend(li);
    }
    mainList.replaceChildren(fragment);
}

/**
 * @param {"noun" | "verb"} params.mode
 * @param {number} [params.page=1]
 */
async function getFavoriteWords({ mode, page = 1 }) {
    const words = await dbFacadeProxy.getWordsByPage(mode, page);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < words.length; i++) {
        const word = words[i].word || words[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.DELETE_WORD}" data-type="${BUTTON.DELETE_WORD}" data-option="${OPTION.GEN_WITH_WORD}" data-table="${mode}" data-word="${word}">${word}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, words.length, { exec: mode, table: mode });
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

/**
 * @returns {void}
 */
async function generateSentences() {
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
        const detaType = isSentExist ? BUTTON.DELETE_SENTENCE : BUTTON.SAVE_SENTENCE;
        const li = document.createElement("li");
        li.innerHTML = `<button class="${detaType}" data-type="${detaType}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.appendChild(li);
    }
    mainList.replaceChildren(fragment);
}

/**
 * @param {string} params.word
 * @param {"noun" | "verb"} params.table
 * @param {string} [params.option]
 * @param {number} [params.page=1]
 */
async function generateSentencesWithWord({ word, table, option, page = 1 }) {
    mainList.className = `${MODE.GENERATE}-list`;
    const fetchType = { noun: "verb", verb: "noun" }[table];
    const words = await dbFacadeProxy.getWordsByPage(fetchType, page);
    const wordLength = words.length;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < wordLength; i++) {
        const w = words[i].word || words[i][0];
        const [noun, verb] = { noun: [word, w], verb: [w, word] }[table];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.SAVE_SENTENCE}" data-type="${BUTTON.SAVE_SENTENCE}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, wordLength, { exec: option, table, word });
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

/**
 * @returns {void}
 */
async function saveWord({ btn, table, word }) {
    await dbFacadeProxy.saveWord(table, word);
    btn.className = btn.dataset.type = BUTTON.DELETE_WORD;
}

/**
 * @param {HTMLButtonElement} params.btn
 * @param {"noun" | "verb"} params.table
 * @param {string} params.word
 */
async function deleteWord({ btn, table, word }) {
    await dbFacadeProxy.deleteWord(table, word);
    btn.className = btn.dataset.type = BUTTON.SAVE_WORD;
}

/**
 * @param {HTMLButtonElement} params.btn
 * @param {string} params.noun
 * @param {string} params.verb
 */
async function saveSentence({ btn, noun, verb }) {
    await dbFacadeProxy.saveSentence(noun, verb);
    btn.className = btn.dataset.type = BUTTON.DELETE_SENTENCE;
}

/**
 * @param {HTMLButtonElement} params.btn
 * @param {string} params.noun
 * @param {string} params.verb
 */
async function deleteSentence({ btn, noun, verb }) {
    await dbFacadeProxy.deleteSentence(noun, verb);
    btn.className = btn.dataset.type = BUTTON.SAVE_SENTENCE;
}

/**
 * @returns {void}
 */
async function registerWordOrSentence() {
    const nounText = nounInput.value.trim();
    const verbText = verbInput.value.trim();
    if (!nounText && !verbText) return;
    try {
        if (nounText && !verbText) {
            await dbFacadeProxy.saveWord("noun", nounText);
            nounInput.value = "";
            await app.modeExecute(MODE.NOUN);
        } else if (!nounText && verbText) {
            await dbFacadeProxy.saveWord("verb", verbText);
            verbInput.value = "";
            await app.modeExecute(MODE.VERB);
        } else {
            await dbFacadeProxy.saveSentence(nounText, verbText);
            nounInput.value = "";
            verbInput.value = "";
            await app.modeExecute(MODE.FAVORITE);
        }
    } catch (error) {
        console.error(error);
    }
}

/**
 * @param {"noun" | "verb"} params.table
 * @param {Number} params.page
 * @param {"noun" | "verb" | "gen_with_word"} params.exec
 * @param {string} params.word
 */
async function pager({ table, page, exec, word }) {
    if (exec === OPTION.GEN_WITH_WORD) {
        await generateSentencesWithWord({ option: exec, table, word, page: Number(page) });
    } else if (exec === MODE.NOUN || exec === MODE.VERB) {
        await getFavoriteWords({ mode: exec, page: Number(page) });
    }
    resultArea.scrollTo(0, 0);
}

/**
 * @returns {void}
 */
function disableAllButtons() {
    const buttons = document.querySelectorAll("button");
    buttons.forEach((btn) => {
        btn.disabled = true;
    });
}

/**
 * @returns {void}
 */
function enableAllButtons() {
    const buttons = document.querySelectorAll("button");
    buttons.forEach((btn) => {
        btn.disabled = false;
    });
}

/**
 * @param {"noun" | "verb"} table
 * @param {Number} page
 * @param {Number} listLength
 * @param {Object} [datasetOptions={}]
 * @returns {HTMLElement | null}
 */
function createPager(page, listLength, datasetOptions = {}) {
    if (!page) return null;
    const currentPage = Number(page, 10);
    const pagerLi = document.createElement("li");
    pagerLi.className = BUTTON.PAGE;
    const setDataset = (btn, targetPage) => {
        btn.dataset.type = BUTTON.PAGE;
        btn.dataset.page = targetPage;
        for (const [key, value] of Object.entries(datasetOptions)) {
            if (value !== undefined) btn.dataset[key] = value;
        }
    };
    if (currentPage > 1) {
        const prevBtn = document.createElement("button");
        setDataset(prevBtn, currentPage - 1);
        prevBtn.className = "page-prev";
        prevBtn.textContent = "◀";
        pagerLi.appendChild(prevBtn);
    }
    if (listLength === WORD_LIMIT) {
        const nextBtn = document.createElement("button");
        setDataset(nextBtn, currentPage + 1);
        nextBtn.className = "page-next";
        nextBtn.textContent = "▶";
        pagerLi.appendChild(nextBtn);
    }
    return pagerLi.hasChildNodes() ? pagerLi : null;
}

const SENT_LIMIT = 300;
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

    exampleBtn.addEventListener("click", () => app.modeExecute(MODE.EXAMPLE));
    genBtn.addEventListener("click", () => app.modeExecute(MODE.GENERATE));
    favBtn.addEventListener("click", () => app.modeExecute(MODE.FAVORITE));
    nounBtn.addEventListener("click", () => app.modeExecute(MODE.NOUN));
    verbBtn.addEventListener("click", () => app.modeExecute(MODE.VERB));
    registerBtn.addEventListener("click", (e) => app.buttonExecute(e.target));

    let pressTimer;
    let isLongPressed = false;

    mainList.addEventListener("click", (e) => {
        if (e.target.tagName !== "BUTTON") return;
        isLongPressed ? (isLongPressed = false) : app.buttonExecute(e.target);
    });

    mainList.addEventListener("touchstart", (e) => {
        isLongPressed = false;
        clearTimeout(pressTimer);
        if (e.target.tagName !== "BUTTON" || !e.target.dataset.option) return;
        pressTimer = setTimeout(() => {
            isLongPressed = true;
            app.optionExecute(e.target);
        }, 500);
    });

    mainList.addEventListener("touchend", () => clearTimeout(pressTimer));
    mainList.addEventListener("touchcancel", () => clearTimeout(pressTimer));
    mainList.addEventListener("touchmove", () => clearTimeout(pressTimer));

    app = new App();

    exampleBtn.click();
});
