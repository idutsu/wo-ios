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
    }
}

const MODE = {
    EXAMPLE  : "example",
    NOUN     : "noun",
    VERB     : "verb",
    GENERATE : "gen",
    FAVORITE : "fav",
};

const MODE_EXECUTE = {
    [MODE.EXAMPLE]  : executeDecorator(getExampleSentences),
    [MODE.NOUN]     : executeDecorator(getFavoriteWords),
    [MODE.VERB]     : executeDecorator(getFavoriteWords),
    [MODE.GENERATE] : executeDecorator(generateSentences),
    [MODE.FAVORITE] : executeDecorator(getFavoriteSentences),
};

const BUTTON = {
    DELETE_SENTENCE : "delete-sent-btn",
    SAVE_SENTENCE   : "save-sent-btn",
    DELETE_WORD     : "delete-word-btn",
    SAVE_WORD       : "save-word-btn",
    PAGER           : "pager",
};

const BUTTON_EXECUTE = {
    [BUTTON.DELETE_SENTENCE] : executeDecorator(deleteSentence),
    [BUTTON.SAVE_SENTENCE]   : executeDecorator(saveSentence),
    [BUTTON.DELETE_WORD]     : executeDecorator(deleteWord),
    [BUTTON.SAVE_WORD]       : executeDecorator(saveWord),
    [BUTTON.PAGER]           : executeDecorator(pager),
};

const CONTEXT = {
    GEN_WITH_NOUN : "gen-with-noun",
    GEN_WITH_VERB : "gen-with-verb",
}

const CONTEXT_EXECUTE = {
    [CONTEXT.GEN_WITH_NOUN] : executeDecorator(generateSentencesWithNoun),
    [CONTEXT.GEN_WITH_VERB] : executeDecorator(generateSentencesWithVerb),
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
        const payload = { btn };
        for (const key in btn.dataset) payload[key] = btn.dataset[key];
        await BUTTON_EXECUTE[payload.type]?.(payload);
    }

    async tapContext(btn) {
        const payload = { btn };
        for (const key in btn.dataset) payload[key] = btn.dataset[key];
        payload.page = 1;
        await CONTEXT_EXECUTE[payload.context]?.(payload);
        resultArea.scrollTo(0, 0);
    }

    async changeMode(mode) {
        this.#mode = mode;
        mainList.className = `${mode}-list`;
        mainList.innerHTML = '';
        const btn = document.getElementById(`${mode}Btn`);
        if (btn) {
            const buttons = modeBox.querySelectorAll("button");
            buttons.forEach((button) => button.classList.remove("active"));
            btn.classList.add("active");
        }
        await MODE_EXECUTE[mode]?.({mode, page: 1});
        resultArea.scrollTo(0, 0);
    }
}

const eventBus = {
    listeners: {},
    subscribe(key, fn) {
        if (!this.listeners[key]) this.listeners[key] = [];
        this.listeners[key].push(fn);
    },
    publish(key, data) {
        if(this.listeners[key]) {
            this.listeners[key].forEach(fn => fn(data));
        }
    }
}

const dbFacade = {
    db: null,

    async init(dbPath) {
        this.db = await Database.load(dbPath);
    },

    async getRandomExampleSentences(limit = 300) {
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
        return await this.db.select(
            `SELECT word FROM ${table} ORDER BY rowid DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
    },

    async getRandomWords(table, limit = 300) {
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
    }
};

function dbProxy(targetDB) {
    const cache = {};

    return new Proxy(targetDB, {
        get: function(target, prop) {
            if (prop === 'getAllWords' || prop === 'getAllSentences') {
                return async function(table = 'sent') {
                    const cacheKey =  table;
                    if (cache[cacheKey]) {
                        console.log(`${table}はキャッシュを利用します。`);
                        return cache[cacheKey];
                    }
                    const result = await target[prop](table);
                    cache[table] = result;
                    return result;
                };
            }

            if (prop === 'saveWord' || prop === 'deleteWord') {
                return async function(...args) {
                    const table = args[0];
                    console.log(`${table} が更新されました。${table}のキャッシュを削除します。`);
                    delete cache[table];
                    const result = await target[prop](...args);
                    eventBus.publish("word", {prop, table});
                    return result;
                };
            }

            if (prop === 'saveSentence' || prop === 'deleteSentence') {
                return async function(...args) {
                    console.log(`お気に入り文が更新されました。sentのキャッシュを削除します。`);
                    delete cache['sent'];
                    const result = await target[prop](...args);
                    eventBus.publish("sent", {prop, table: 'sent'});
                    return result;
                };
            }

            return target[prop];
        }
    });
}

const dbFacadeProxy = dbProxy(dbFacade);

async function getExampleSentences() {
    mainList.innerHTML = "<p>読み込み中・・・</p>";

    const rows = await dbFacadeProxy.getRandomExampleSentences(300);
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

    mainList.replaceChildren(fragment);
}

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

async function getFavoriteWords({mode, page}) {
    const wordList = page ? await dbFacadeProxy.getWordsByPage(mode, page) : await dbFacadeProxy.getAllWords(mode);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < wordList.length; i++) {
        const word = wordList[i].word || wordList[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.DELETE_WORD}" data-type="${BUTTON.DELETE_WORD}" data-context="${mode === MODE.NOUN ? "gen-with-noun" : "gen-with-verb"}" data-table="${mode}" data-word="${word}">${word}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, wordList.length, {table: mode});
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

async function pager({table, page, pager, word}) {
    if (pager === CONTEXT.GEN_WITH_NOUN) {
        await generateSentencesWithNoun({ word, page: Number(page) });
    } else if (pager === CONTEXT.GEN_WITH_VERB) {
        await generateSentencesWithVerb({ word, page: Number(page) });
    } else {
        await getFavoriteWords({ mode: table, page: Number(page) });
    }
    resultArea.scrollTo(0, 0);
}

async function generateSentences(mode) {
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
        const sentBtnClass = isSentExist ? BUTTON.DELETE_SENTENCE : BUTTON.SAVE_SENTENCE;
        const li = document.createElement("li");
        li.innerHTML = `<button class="${sentBtnClass}" data-type="${sentBtnClass}" data-table="sent" data-noun="${noun}" data-verb="${verb}">${noun}を${verb}</button>`;
        fragment.appendChild(li);
    }
    mainList.replaceChildren(fragment);
}

async function generateSentencesWithNoun({btn, word, page}) {
    mainList.className = "gen-list";
    const wordList = page ? await dbFacadeProxy.getWordsByPage("verb", page) : await dbFacadeProxy.getAllWords("verb");
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < wordList.length; i++) {
        const w = wordList[i].word || wordList[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.SAVE_SENTENCE}" data-type="${BUTTON.SAVE_SENTENCE}" data-table="sent" data-noun="${word}" data-verb="${w}">${word}を${w}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, wordList.length, { pager: "gen-with-noun", word: word });
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

async function generateSentencesWithVerb({btn, word, page}) {
    mainList.className = "gen-list";
    const wordList = page ? await dbFacadeProxy.getWordsByPage("noun", page) : await dbFacadeProxy.getAllWords("noun");
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < wordList.length; i++) {
        const w = wordList[i].word || wordList[i][0];
        const li = document.createElement("li");
        li.innerHTML = `<button class="${BUTTON.SAVE_SENTENCE}" data-type="${BUTTON.SAVE_SENTENCE}" data-table="sent" data-noun="${w}" data-verb="${word}">${w}を${word}</button>`;
        fragment.append(li);
    }
    const pager = createPager(page, wordList.length, { pager: "gen-with-verb", word: word });
    if (pager) fragment.append(pager);
    mainList.replaceChildren(fragment);
}

async function saveWord({ btn, table, word }) {
    await dbFacadeProxy.saveWord(table, word);
    btn.className = btn.dataset.type = BUTTON.DELETE_WORD;
}

async function deleteWord({ btn, table, word }) {
    await dbFacadeProxy.deleteWord(table, word);
    btn.className = btn.dataset.type = BUTTON.SAVE_WORD;
}

async function saveSentence({ btn, noun, verb }) {
    await dbFacadeProxy.saveSentence(noun, verb);
    btn.className = btn.dataset.type = BUTTON.DELETE_SENTENCE;
}

async function deleteSentence({ btn, noun, verb }) {
    await dbFacadeProxy.deleteSentence(noun, verb);
    btn.className = btn.dataset.type = BUTTON.SAVE_SENTENCE;
}

const register = async (e) => {
    const nounText = nounInput.value.trim();
    const verbText = verbInput.value.trim();
    if (!nounText && !verbText) return;
    try {
        if (nounText && !verbText) {
            await dbFacadeProxy.saveWord("noun", nounText);
            nounInput.value = "";
            nounBtn.click();
        } else if (!nounText && verbText) {
            await dbFacadeProxy.saveWord("verb", verbText);
            verbInput.value = "";
            verbBtn.click();
        } else {
            await dbFacadeProxy.saveSentence(nounText, verbText);
            nounInput.value = "";
            verbInput.value = "";
            favBtn.click();
        }
    } catch (error) {
        console.error(error);
    }
};

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

function createPager(page, listLength, datasetOptions = {}) {
    if (!page) return null;
    const currentPage = parseInt(page, 10);
    const pagerLi = document.createElement("li");
    pagerLi.className = BUTTON.PAGER;
    const setDataset = (btn, targetPage) => {
        btn.dataset.type = BUTTON.PAGER;
        btn.dataset.page = targetPage;
        for (const [key, value] of Object.entries(datasetOptions)) {
            if (value !== undefined) btn.dataset[key] = value;
        }
    };
    if (currentPage > 1) {
        const prevBtn = document.createElement("button");
        setDataset(prevBtn, currentPage - 1);
        prevBtn.className = "pager-prev";
        prevBtn.textContent = "◀";
        pagerLi.appendChild(prevBtn);
    }
    if (listLength === WORD_LIMIT) {
        const nextBtn = document.createElement("button");
        setDataset(nextBtn, currentPage + 1);
        nextBtn.className = "pager-next";
        nextBtn.textContent = "▶";
        pagerLi.appendChild(nextBtn);
    }
    return pagerLi.hasChildNodes() ? pagerLi : null;
}

const SENT_LIMIT = 300;
const WORD_LIMIT = 100;

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

    exampleBtn.addEventListener("click", () => app.changeMode(MODE.EXAMPLE));
    genBtn.addEventListener("click", () => app.changeMode(MODE.GENERATE));
    favBtn.addEventListener("click", () => app.changeMode(MODE.FAVORITE));
    nounBtn.addEventListener("click", () => app.changeMode(MODE.NOUN));
    verbBtn.addEventListener("click", () => app.changeMode(MODE.VERB));
    registerBtn.addEventListener("click", register);

    let pressTimer;
    let isLongPressed = false;

    mainList.addEventListener("click", (e) => {
        if (e.target.tagName !== "BUTTON") return;
        isLongPressed ? isLongPressed = false : app.tapButton(e.target);
    });

    mainList.addEventListener("touchstart", (e) =>{
        isLongPressed = false;
        clearTimeout(pressTimer);
        if (e.target.tagName !== "BUTTON" || !e.target.dataset.context) return;
        pressTimer = setTimeout(() => {
            isLongPressed = true;
            app.tapContext(e.target);
        }, 500);
    });

    mainList.addEventListener("touchend", () => clearTimeout(pressTimer));
    mainList.addEventListener("touchcancel", () => clearTimeout(pressTimer));
    mainList.addEventListener("touchmove", () => clearTimeout(pressTimer));

    app = new App();

    exampleBtn.click();
});
