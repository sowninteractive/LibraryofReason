"use strict";

const STORAGE_KEY = "library-of-reason-progress";
const THEME_KEY = "library-of-reason-theme";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ } }
};

// Section list comes from the DOM, so it can never drift out of sync with the HTML.
const sections = $$(".content-area");
const SECTION_IDS = sections.map((s) => s.id);
const navLinks = $$(".site-nav a");

/* ---------- Progress ---------- */
function readProgress() {
    try {
        const saved = JSON.parse(store.get(STORAGE_KEY));
        return Array.isArray(saved) ? saved.filter((id) => SECTION_IDS.includes(id)) : [];
    } catch (e) { return []; }
}

function renderProgress(list) {
    const pct = SECTION_IDS.length ? Math.round((list.length / SECTION_IDS.length) * 100) : 0;
    const fill = $("#progress-fill");
    if (fill) fill.style.width = pct + "%";
    const bar = $(".progress-bar");
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
    navLinks.forEach((link) => {
        link.classList.toggle("read", list.includes(link.hash.slice(1)));
    });
}

function markRead(id) {
    const list = readProgress();
    if (!list.includes(id)) {
        list.push(id);
        store.set(STORAGE_KEY, JSON.stringify(list));
        renderProgress(list);
    }
}

/* ---------- Scroll spy: a section is "active" and "read" once it crosses mid-screen ---------- */
function initScrollSpy() {
    renderProgress(readProgress());
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const id = entry.target.id;
            navLinks.forEach((l) => l.classList.toggle("active", l.hash.slice(1) === id));
            const cur = $("#nav-current"), a = $(".site-nav a.active");
            if (cur && a) cur.textContent = a.textContent;
            markRead(id);
        });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    sections.forEach((s) => observer.observe(s));
}

/* ---------- Contents menu ---------- */
function initNav() {
    const toggle = $("#nav-toggle"), panel = $("#nav-panel");
    if (!toggle || !panel) return;
    function setOpen(open) {
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
    }
    toggle.addEventListener("click", () => setOpen(panel.hidden));
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".site-nav")) setOpen(false); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) { setOpen(false); toggle.focus(); }
    });
}

/* ---------- Previous / next links ---------- */
function initPager() {
    sections.forEach((section, i) => {
        const nav = document.createElement("nav");
        nav.className = "pager";
        nav.setAttribute("aria-label", "Section navigation");
        [[i - 1, "Previous", "prev"], [i + 1, "Next", "next"]].forEach(([k, label, cls]) => {
            const target = sections[k];
            if (!target) return;
            const a = document.createElement("a");
            a.href = "#" + target.id;
            a.className = cls;
            const small = document.createElement("small");
            small.textContent = label;
            const title = document.createElement("span");
            title.textContent = $("h2", target).textContent;
            a.append(small, title);
            nav.append(a);
        });
        section.append(nav);
    });
}

/* ---------- Keyboard: "/" focuses search ---------- */
function initShortcuts() {
    document.addEventListener("keydown", (e) => {
        const tag = (e.target.tagName || "").toLowerCase();
        if (e.key === "/" && tag !== "input" && tag !== "textarea") {
            e.preventDefault();
            const s = $("#search");
            if (s) s.focus();
        }
    });
}

/* ---------- Header height -> CSS var, so anchors never hide under the sticky header ---------- */
function initHeaderOffset() {
    const header = $(".site-header");
    if (!header) return;
    const set = () => document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
    set();
    if ("ResizeObserver" in window) new ResizeObserver(set).observe(header);
    else window.addEventListener("resize", set);
}

/* ---------- Back to top (rAF-throttled, passive) ---------- */
function initBackToTop() {
    const btn = $("#back-to-top");
    if (!btn) return;
    let ticking = false;
    window.addEventListener("scroll", () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            btn.classList.toggle("visible", window.scrollY > 300);
            ticking = false;
        });
    }, { passive: true });
    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

/* ---------- Theme: saved choice, else system preference ---------- */
function initTheme() {
    const toggle = $("#theme-toggle");
    const root = document.documentElement;
    const meta = $('meta[name="theme-color"]');
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function apply(theme) {
        root.classList.toggle("dark", theme === "dark");
        if (meta) meta.setAttribute("content", theme === "dark" ? "#14110d" : "#2c2824");
        if (toggle) {
            toggle.setAttribute("aria-pressed", String(theme === "dark"));
            const icon = $(".theme-icon", toggle);
            if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
        }
    }

    apply(store.get(THEME_KEY) || (media.matches ? "dark" : "light"));

    if (toggle) {
        toggle.addEventListener("click", () => {
            const next = root.classList.contains("dark") ? "light" : "dark";
            store.set(THEME_KEY, next);
            apply(next);
        });
    }
    media.addEventListener("change", (e) => {
        if (!store.get(THEME_KEY)) apply(e.matches ? "dark" : "light");
    });
}

/* ---------- Search: text cached once, debounced, non-matches hidden, matches highlighted ---------- */
function initSearch() {
    const input = $("#search");
    if (!input) return;
    const resultsEl = $("#search-results");
    const empty = $("#no-results");
    const index = sections.map((s) => ({ el: s, text: s.textContent.toLowerCase() }));
    let timer;

    function highlight(query) {
        if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
        CSS.highlights.delete("search");
        if (query.length < 2) return;
        const ranges = [];
        index.forEach(({ el }) => {
            if (el.hidden) return;
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const lower = node.nodeValue.toLowerCase();
                let from = 0, at;
                while ((at = lower.indexOf(query, from)) !== -1) {
                    const r = new Range();
                    r.setStart(node, at);
                    r.setEnd(node, at + query.length);
                    ranges.push(r);
                    from = at + query.length;
                }
            }
        });
        if (ranges.length) CSS.highlights.set("search", new Highlight(...ranges));
    }

    function run() {
        const query = input.value.trim().toLowerCase();
        let count = 0;
        index.forEach(({ el, text }) => {
            const match = !query || text.includes(query);
            el.hidden = !match;
            if (match) count++;
            navLinks.forEach((l) => {
                if (l.hash.slice(1) === el.id) l.classList.toggle("dim", !match);
            });
        });
        if (empty) empty.hidden = count !== 0;
        if (resultsEl) {
            resultsEl.textContent = !query ? "All sections" : count + (count === 1 ? " section" : " sections");
        }
        highlight(query);
    }

    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 120); });

    // Jumping to a section that search has hidden: clear the search first.
    navLinks.forEach((link) => {
        link.addEventListener("click", () => {
            const target = document.getElementById(link.hash.slice(1));
            if (target && target.hidden) { input.value = ""; run(); }
        });
    });
}

/* ---------- Reading time (placed after the h2 so the heading's name stays clean) ---------- */
function initReadingTime() {
    sections.forEach((section) => {
        const words = section.textContent.split(/\s+/).filter(Boolean).length;
        const minutes = Math.max(1, Math.ceil(words / 238));
        const badge = document.createElement("span");
        badge.className = "reading-time";
        badge.textContent = minutes + " min read";
        const h2 = $("h2", section);
        if (h2) h2.after(badge);
    });
}


/* ---------- Self-check quiz ---------- */
const QUIZ = [
    ["What does the non-aggression principle prohibit?", ["Initiating force or fraud", "All use of force, including self-defense", "Any action that harms a competitor", "Only taxation"], 0, "Libertarians allow defensive force. The NAP targets initiating force, threat, or fraud."],
    ["What is Hayek's knowledge problem?", ["People are too selfish to cooperate", "Knowledge is dispersed, so no planner can collect it all", "Markets cannot set prices", "Governments hide information"], 1, "Hayek argued prices transmit scattered, local knowledge that no central authority can gather."],
    ["How do minarchists differ from anarcho-capitalists?", ["They reject property rights", "They accept a minimal, rights-protecting state", "They support central planning", "They reject the NAP"], 1, "Both share the NAP. Minarchists keep a minimal state; anarcho-capitalists would provide even law and defense voluntarily."],
    ["UPB begins from which observation?", ["Most societies agree on morality", "Debating ethics already presupposes preferring truth and argument", "Laws should follow tradition", "Religion grounds ethics"], 1, "Molyneux argues that arguing about ethics already treats truth and reason as preferable."],
    ["What was David Gordon's core objection to UPB?", ["It was too religious", "It confuses what one must prefer to argue with what is morally obligatory", "It rejects the NAP", "It ignores economics"], 1, "Gordon argued the theory slides between two senses of \"preferable.\""],
    ["What did the 2016 Gershoff and Grogan-Kaylor meta-analysis find about spanking?", ["Clear benefits for obedience", "No relationship to outcomes", "Links to worse outcomes and no clear benefits", "Benefits only for teenagers"], 2, "Most of the evidence is correlational, but it points consistently one way."],
    ["Economic-freedom indexes show richer countries tend to be freer. What can we conclude?", ["Freedom causes wealth, proven", "An association exists; cause needs more evidence", "Wealth causes freedom, proven", "Nothing at all"], 1, "Association is not proof of cause. Wealth, institutions, and history all interact."],
    ["When did Stefan Molyneux launch Freedomain Radio?", ["1995", "2005", "2015", "2020"], 1, "Freedomain Radio began as a podcast in 2005 and grew into a large online community."],
    ["What link does Molyneux draw between parenting and politics?", ["Parents should run local government", "Early experience of violence shapes how people view political force", "Schools should replace parents", "Politics has no connection to family life"], 1, "His thesis is that ending violence in the home helps end acceptance of force in society. Critics say the evidence is indirect."],
    ["Which is NOT aggression under the NAP?", ["Fraud", "Theft", "Opening a cheaper rival bakery", "A threat to break a window"], 2, "Competing harms a rival's profits but uses no force, threat, or fraud."],
    ["Which approach fits peaceful parenting?", ["Threaten a smack if it happens again", "Name the feeling, state the limit, and follow through calmly", "Remove all rules", "Ignore the behavior"], 1, "It is firm without being harsh: limits stay, and violence and humiliation go."],
    ["What did Ronald Coase's lighthouse study show?", ["Lighthouses cannot exist without government", "Many English lighthouses were privately built and funded by port fees", "Lighthouses are unnecessary", "Fees always fail"], 1, "The Crown granted the rights, so critics call it an imperfect market example, but it challenged the textbook claim."],
    ["Why do critics say medieval Iceland is an imperfect example?", ["It had a king", "Power later concentrated in a few chieftains, ending in conflict", "It lasted only ten years", "It had no laws"], 1, "It lasted over three centuries, but its final decades saw civil conflict before it accepted Norway's king."],
    ["What is the core argument against spanking from the NAP?", ["Children are always right", "Hitting a smaller, dependent child is violence we would never accept against an adult", "Parents should have no authority", "Spanking is illegal everywhere"], 1, "The argument is one of consistency: dependence makes a child more vulnerable, so hitting needs far stronger justification than it can offer."],
    ["Which is NOT one of Gottman's four damaging habits?", ["Criticism", "Contempt", "Stonewalling", "Generosity"], 3, "The four are criticism, contempt, defensiveness, and stonewalling."]
];

function initQuiz() {
    const root = $("#quiz-root");
    if (!root) return;
    root.textContent = "";
    let answered = 0, correct = 0;
    const score = $("#quiz-score");
    const retry = $("#quiz-retry");
    retry.hidden = true;
    retry.onclick = initQuiz;
    score.textContent = "";
    QUIZ.forEach(([q, opts, ans, why], n) => {
        const box = document.createElement("div");
        box.className = "quiz-q";
        const p = document.createElement("p");
        p.innerHTML = "<strong></strong>";
        p.firstChild.textContent = (n + 1) + ". " + q;
        const fb = document.createElement("p");
        fb.className = "quiz-fb";
        fb.setAttribute("aria-live", "polite");
        box.append(p);
        const btns = opts.map((text, i) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = text;
            b.addEventListener("click", () => {
                btns.forEach((x, k) => { x.disabled = true; if (k === ans) x.classList.add("right"); });
                if (i !== ans) b.classList.add("wrong");
                fb.textContent = (i === ans ? "Correct. " : "Not quite. ") + why;
                answered++; if (i === ans) correct++;
                score.textContent = "Score: " + correct + " of " + answered + " answered (" + QUIZ.length + " total)";
                if (answered === QUIZ.length) {
                    score.textContent = "Final score: " + correct + " of " + QUIZ.length + (correct === QUIZ.length ? ". Excellent." : correct >= 6 ? ". Well done." : ". Re-read the sections above and try again.");
                    retry.hidden = false;
                }
            });
            box.append(b);
            return b;
        });
        box.append(fb);
        root.append(box);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initQuiz();
    initNav();
    initTheme();
    initHeaderOffset();
    initReadingTime();
    initSearch();
    initScrollSpy();
    initPager();
    initShortcuts();
    initBackToTop();
});
