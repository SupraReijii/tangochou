(function () {
  "use strict";

  var MODES = {
    recognition: { jp: "見る", en: "Recognition", color: "var(--ai)", soft: "var(--ai-soft)",
      desc: "See the image, recall the word in your head, then reveal. No typing." },
    recall: { jp: "書く", en: "Recall", color: "var(--shu)", soft: "var(--shu-soft)",
      desc: "See the image, type the Japanese word yourself before revealing." },
    reverse: { jp: "訳す", en: "Reverse", color: "var(--matcha)", soft: "var(--matcha-soft)",
      desc: "See the Japanese term first, recall its meaning — translating out of Japanese." }
  };

  var appEl = document.getElementById("app");
  var userEmail = appEl.dataset.userEmail || "";
  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";

  var state = {
    view: "home",
    cards: [],
    loaded: false,
    editingId: null,
    pendingImage: null,
    autoImageStatus: null,
    autoImageToken: 0,
    lastAutoImageQuery: null,
    imageSuggestions: null,
    selectedSuggestionIndex: null,
    suggestionBusyIndex: null,
    suggestionSelectToken: 0,
    filterTag: "all",
    dueOnly: true,
    autoKana: readLocal("tangochou_autokana", true),
    study: null
  };

  function readLocal(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function writeLocal(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  // ---------- API ----------

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "X-CSRF-Token": csrfToken, Accept: "application/json" }, opts.headers || {});
    opts.credentials = "same-origin";
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { window.location.href = "/login"; throw new Error("unauthorized"); }
      if (r.status === 204) return null;
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) throw Object.assign(new Error((body && body.error) || "Request failed"), { body: body });
        return body;
      });
    });
  }

  function loadCards() { return api("/cards"); }
  function createCard(data) {
    return api("/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  }
  function updateCard(id, data) {
    return api("/cards/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  }
  function deleteCard(id) { return api("/cards/" + id, { method: "DELETE" }); }
  function gradeCard(id, grade) {
    return api("/cards/" + id + "/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grade: grade }) });
  }
  function uploadImage(blob) {
    var fd = new FormData();
    fd.append("image", blob, "card.jpg");
    return api("/images", { method: "POST", body: fd });
  }
  function signOut() {
    api("/logout", { method: "DELETE" }).catch(function () {}).then(function () {
      window.location.href = "/login";
    });
  }

  // ---------- derived data ----------

  function imgSrc(c) { return c.image_url; }

  function distinctTags() {
    var set = {};
    state.cards.forEach(function (c) {
      (c.tags || "").split(",").forEach(function (t) {
        t = t.trim();
        if (t) set[t] = true;
      });
    });
    return Object.keys(set).sort();
  }

  function cardHasTag(c, tag) {
    if (tag === "all") return true;
    return (c.tags || "").split(",").map(function (t) { return t.trim(); }).indexOf(tag) !== -1;
  }

  function filteredCards() {
    return state.cards.filter(function (c) { return cardHasTag(c, state.filterTag); });
  }

  // ---------- rendering ----------

  function render() {
    var header =
      '<header class="topbar"><div class="topbar-inner">' +
        '<div class="brand"><span class="brand-jp">単語帳</span><span class="brand-en">Tangochou</span></div>' +
        (state.view === "study" ? "" :
          '<nav class="tabs">' +
            '<button class="tab ' + (state.view === "home" ? "active" : "") + '" data-action="nav-home">Home</button>' +
            '<button class="tab ' + (state.view === "deck" ? "active" : "") + '" data-action="nav-deck">My Deck</button>' +
          '</nav>' +
          '<span id="due-badge"></span>' +
          '<span class="user-email">' + esc(userEmail) + '</span>' +
          '<button class="btn btn-ghost" data-action="sign-out">Sign out</button>'
        ) +
      '</div></header>';

    var main = "<main class=\"wrap\">" + renderMain() + "</main>";
    appEl.innerHTML = header + main;
    updateDueBadge();
    afterRender();
  }

  function renderMain() {
    if (!state.loaded) return '<div class="section-head"><h1>読み込み中…</h1><p>Loading your deck…</p></div>';
    if (state.view === "study" && state.study) return renderStudy();
    if (state.view === "deck") return renderDeck();
    return renderHome();
  }

  function updateDueBadge() {
    var el = document.getElementById("due-badge");
    if (!el) return;
    var due = state.cards.filter(function (c) { return c.due; }).length;
    el.innerHTML = due > 0 ? '<span class="due-pill"><span class="dot"></span>' + due + " due</span>" : "";
  }

  function renderHome() {
    var total = state.cards.length;
    var due = state.cards.filter(function (c) { return c.due; }).length;
    var mastered = state.cards.filter(function (c) { return c.mastered; }).length;

    if (total === 0) {
      return (
        '<div class="section-head"><h1>おかえりなさい</h1><p>Build a personal deck of image ↔ Japanese flashcards, then drill it three ways.</p></div>' +
        '<div class="empty-panel">' +
          '<span class="example-tag">Example card</span>' +
          '<div class="example-card">' +
            '<div class="example-img">🐕</div>' +
            '<div class="example-text"><div class="example-jp">犬</div><div class="example-reading">いぬ · inu</div><div class="example-en">dog</div></div>' +
          '</div>' +
          '<p style="color:var(--ink-soft);font-size:13.5px;max-width:38ch;margin:0 auto 18px;">Every card pairs a photo with its Japanese word — add your first one to start studying.</p>' +
          '<button class="btn btn-primary" data-action="nav-deck">Add your first word</button>' +
        '</div>'
      );
    }

    var tags = distinctTags();
    var tagOptions = '<option value="all">All decks</option>' + tags.map(function (t) {
      return '<option value="' + esc(t) + '"' + (state.filterTag === t ? " selected" : "") + '>' + esc(t) + "</option>";
    }).join("");

    var pool = filteredCards();
    var poolDue = pool.filter(function (c) { return c.due; }).length;

    var slips = ["recognition", "recall", "reverse"].map(function (key) {
      var m = MODES[key];
      var count = state.dueOnly ? poolDue : pool.length;
      return (
        '<div class="mode-slip" style="--mode-color:' + m.color + ';--mode-soft:' + m.soft + '">' +
          '<div class="mode-glyph">' + m.jp[0] + "</div>" +
          '<div class="mode-body"><h3>' + m.jp + '</h3><div class="mode-en">' + m.en + "</div><p>" + m.desc + "</p>" +
            '<div class="mode-count">' + count + (state.dueOnly ? " due now" : " in this deck") + "</div></div>" +
          '<button class="btn btn-primary" data-action="start-study" data-mode="' + key + '"' + (count === 0 ? " disabled" : "") + ">Begin</button>" +
        "</div>"
      );
    }).join("");

    return (
      '<div class="section-head"><h1>今日の単語</h1><p>Today’s words — pick a mode to start a study session.</p></div>' +
      '<div class="stat-row">' +
        '<div class="stat-tile"><div class="stat-num">' + total + '</div><div class="stat-label">Total cards</div></div>' +
        '<div class="stat-tile"><div class="stat-num">' + due + '</div><div class="stat-label">Due today</div></div>' +
        '<div class="stat-tile"><div class="stat-num">' + mastered + '</div><div class="stat-label">Mastered</div></div>' +
      '</div>' +
      '<div class="filter-row">' +
        '<select id="home-tag-filter">' + tagOptions + '</select>' +
        '<label class="toggle-chip"><input type="checkbox" id="home-due-toggle"' + (state.dueOnly ? " checked" : "") + '> Due cards only</label>' +
      '</div>' +
      '<div class="mode-grid">' + slips + '</div>'
    );
  }

  function renderDeck() {
    var editing = state.editingId ? state.cards.find(function (c) { return c.id === state.editingId; }) : null;
    var tags = distinctTags();
    var tagOptions = '<option value="all">All tags</option>' + tags.map(function (t) {
      return '<option value="' + esc(t) + '"' + (state.filterTag === t ? " selected" : "") + '>' + esc(t) + "</option>";
    }).join("");

    return (
      '<div class="section-head"><h1>マイ単語帳</h1><p>Add cards with an image on one side and the Japanese term on the other.</p></div>' +
      renderCardForm(editing) +
      '<div class="filter-row">' +
        '<input type="text" id="deck-search" placeholder="Search word or meaning…" value="">' +
        '<select id="deck-tag-filter">' + tagOptions + '</select>' +
      '</div>' +
      '<div id="deck-list">' + renderDeckListItemsHTML() + '</div>'
    );
  }

  function renderCardForm(editing) {
    return (
      '<form class="card-form" id="card-form">' +
        '<h2>' + (editing ? "Edit card" : "Add a card") + '</h2>' +
        '<p class="form-sub">' + (editing ? "Update this word, then save." : "One image, one Japanese word, one meaning.") + '</p>' +
        '<div class="form-grid">' +
          '<div id="img-drop-wrap">' + renderImgDropHTML() + '</div>' +
          '<div class="field-cols">' +
            '<div class="field-row">' +
              '<div class="field"><label for="f-jp">Japanese</label><input type="text" id="f-jp" placeholder="犬" value="' + esc(editing ? editing.japanese : "") + '" required></div>' +
              '<div class="field"><label for="f-reading">Reading (kana)</label><input type="text" id="f-reading" placeholder="いぬ" value="' + esc(editing ? editing.reading : "") + '"></div>' +
            '</div>' +
            '<div class="field"><label for="f-meaning">Meaning</label><input type="text" id="f-meaning" placeholder="dog" value="' + esc(editing ? editing.meaning : "") + '" required></div>' +
            '<div class="field"><label for="f-tags">Tags <span style="text-transform:none;color:var(--ink-faint)">(optional, comma-separated)</span></label><input type="text" id="f-tags" placeholder="animals, N5" value="' + esc(editing ? editing.tags : "") + '"></div>' +
            '<div class="field-error" id="form-error" hidden></div>' +
          '</div>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="submit" class="btn btn-primary">' + (editing ? "Save changes" : "Add card") + '</button>' +
          (editing ? '<button type="button" class="btn btn-ghost" data-action="cancel-edit">Cancel</button>' : '') +
        '</div>' +
      '</form>'
    );
  }

  function renderImgDropHTML() {
    var img = state.pendingImage;
    var dropHtml;
    if (img) {
      dropHtml =
        '<div class="img-drop has-image" id="img-drop">' +
          '<img src="' + esc(img.url) + '" alt="">' +
          (img.auto ? '<span class="img-auto-badge">auto</span>' : '') +
          '<button type="button" class="img-remove" data-action="remove-image" title="Remove image">✕</button>' +
        '</div>';
    } else if (state.autoImageStatus) {
      var label = state.autoImageStatus === "searching" ? "Finding…" : "Drawing…";
      dropHtml = '<div class="img-drop is-busy" id="img-drop"><span class="img-drop-spinner"></span><span class="img-drop-caption">' + label + '</span></div>';
    } else {
      dropHtml = '<div class="img-drop" id="img-drop">Add photo<input type="file" accept="image/*" id="image-input"></div>';
    }

    var suggestionsHtml = renderSuggestionThumbsHTML();
    var hint = (!img && !state.autoImageStatus) ?
      '<div class="img-drop-hint">' + (suggestionsHtml ? "Tap a suggestion, or upload your own" : "Type a word to auto-fill, or upload your own") + '</div>' : "";

    return '<div class="img-picker">' + dropHtml + suggestionsHtml + '</div>' + hint;
  }

  function renderSuggestionThumbsHTML() {
    if (!state.imageSuggestions || !state.imageSuggestions.length) return "";
    return state.imageSuggestions.map(function (sug, i) {
      var selected = state.selectedSuggestionIndex === i;
      var busy = state.suggestionBusyIndex === i;
      var label = sug.type === "generated" ? "Generated tile" : ("Photo: " + sug.title);
      return (
        '<button type="button" class="suggestion-thumb' + (selected ? ' selected' : '') + '" data-action="select-suggestion" data-index="' + i + '" title="' + esc(label) + '">' +
          '<img src="' + esc(sug.previewUrl) + '" alt="" loading="lazy">' +
          (busy ? '<span class="suggestion-busy-overlay"><span class="img-drop-spinner"></span></span>' : '') +
        '</button>'
      );
    }).join("");
  }

  function refreshImgDropOnly() {
    var el = document.getElementById("img-drop-wrap");
    if (el) el.innerHTML = renderImgDropHTML();
    bindImageInput();
  }

  function bindImageInput() {
    var fileInput = document.getElementById("image-input");
    if (fileInput) fileInput.addEventListener("change", onFileSelected);
  }

  function renderDeckListItemsHTML() {
    var q = (document.getElementById("deck-search") || {}).value || "";
    q = q.trim().toLowerCase();
    var list = filteredCards().filter(function (c) {
      if (!q) return true;
      return (c.japanese || "").toLowerCase().indexOf(q) !== -1 ||
        (c.reading || "").toLowerCase().indexOf(q) !== -1 ||
        (c.meaning || "").toLowerCase().indexOf(q) !== -1;
    });
    if (list.length === 0) return '<div class="empty-list-msg">No cards match.</div>';
    return '<div class="deck-list">' + list.map(function (c) {
      var thumb = imgSrc(c) ? '<img class="deck-thumb" src="' + esc(imgSrc(c)) + '" alt="">' : '<div class="deck-thumb-fallback">字</div>';
      var boxLabel = c.mastered ? "mastered" : (c.due ? "due" : "box " + c.box);
      return (
        '<div class="deck-row">' + thumb +
          '<div class="deck-info"><div class="deck-jp">' + esc(c.japanese) + (c.reading ? '<span class="deck-reading"> · ' + esc(c.reading) + '</span>' : '') + '</div>' +
          '<div class="deck-meaning">' + esc(c.meaning) + '</div></div>' +
          '<div class="deck-box">' + boxLabel + '</div>' +
          '<div class="deck-actions">' +
            '<button class="icon-btn" data-action="edit-card" data-id="' + c.id + '" title="Edit">✎</button>' +
            '<button class="icon-btn" data-action="delete-card" data-id="' + c.id + '" title="Delete">🗑</button>' +
          '</div>' +
        '</div>'
      );
    }).join("") + '</div>';
  }

  // ---------- study session ----------

  function startStudy(mode) {
    var pool = filteredCards().filter(function (c) { return !state.dueOnly || c.due; });
    if (pool.length === 0) { toast("No cards to study — try All cards."); return; }
    var queue = pool.slice();
    for (var i = queue.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = queue[i]; queue[i] = queue[j]; queue[j] = t;
    }
    state.study = { mode: mode, queue: queue, pos: 0, results: [], revealed: false, checked: false, checkedCorrect: null, typed: "" };
    state.view = "study";
    render();
  }

  function endStudy() { state.study = null; state.view = "home"; render(); }
  function currentCard() { return state.study.queue[state.study.pos]; }

  function renderStudy() {
    var s = state.study;
    if (s.pos >= s.queue.length) return renderSummary();
    var card = currentCard();
    var mode = MODES[s.mode];
    var pct = Math.round((s.pos / s.queue.length) * 100);

    var topbar =
      '<div class="study-topbar">' +
        '<span class="study-mode-tag">' + mode.en + '</span>' +
        '<div class="study-progress-track"><div class="study-progress-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="study-count">' + (s.pos + 1) + ' / ' + s.queue.length + '</span>' +
        '<button class="btn btn-ghost" data-action="exit-study">Exit</button>' +
      '</div>';

    var stageHtml;
    if (s.mode === "reverse") stageHtml = renderReverseStage(card, s);
    else if (s.mode === "recall") stageHtml = renderRecallStage(card, s);
    else stageHtml = renderRecognitionStage(card, s);

    return topbar + '<div class="study-stage"><div class="tanzaku">' + stageHtml + '</div></div>';
  }

  function imageBlock(card) {
    var src = imgSrc(card);
    return '<div class="study-img-wrap">' + (src ? '<img src="' + esc(src) + '" alt="">' : '<span class="study-img-fallback">字</span>') + '</div>';
  }

  function gradeRowHtml(suggested) {
    var grades = [
      { key: "again", label: "Again", num: "1" },
      { key: "hard", label: "Hard", num: "2" },
      { key: "good", label: "Good", num: "3" },
      { key: "easy", label: "Easy", num: "4" }
    ];
    return '<div class="grade-row">' + grades.map(function (g) {
      return '<button class="grade-btn ' + g.key + (suggested === g.key ? ' suggested' : '') + '" data-action="grade" data-grade="' + g.key + '">' +
        '<span class="g-label">' + g.label + '</span><span class="g-key">' + g.num + '</span></button>';
    }).join("") + '</div>';
  }

  function renderRecognitionStage(card, s) {
    if (!s.revealed) return imageBlock(card) + '<button class="reveal-btn" data-action="reveal">Show answer</button><span class="hint-key">press space</span>';
    return imageBlock(card) +
      '<div class="reveal-block"><div class="study-jp">' + esc(card.japanese) + '</div>' +
      (card.reading ? '<div class="study-reading">' + esc(card.reading) + '</div>' : '') +
      '<div class="reveal-meaning">' + esc(card.meaning) + '</div></div>' + gradeRowHtml(null);
  }

  function renderReverseStage(card, s) {
    if (!s.revealed) {
      return '<div class="study-jp">' + esc(card.japanese) + '</div>' +
        (card.reading ? '<div class="study-reading">' + esc(card.reading) + '</div>' : '') +
        '<button class="reveal-btn" data-action="reveal">Show meaning</button><span class="hint-key">press space</span>';
    }
    return '<div class="study-jp">' + esc(card.japanese) + '</div>' +
      (card.reading ? '<div class="study-reading">' + esc(card.reading) + '</div>' : '') +
      '<div class="reveal-block">' + imageBlock(card) + '<div class="reveal-meaning">' + esc(card.meaning) + '</div></div>' + gradeRowHtml(null);
  }

  function renderRecallStage(card, s) {
    var img = imageBlock(card);
    if (!s.checked) {
      return img +
        '<form class="answer-form" id="answer-form">' +
          '<div class="answer-input-row">' +
            '<input type="text" class="answer-input" id="answer-input" placeholder="にほんご" autocomplete="off" value="' + esc(s.typed) + '">' +
            '<button type="submit" class="btn btn-primary">Check</button>' +
          '</div>' +
          '<label class="kana-toggle"><input type="checkbox" id="kana-toggle"' + (state.autoKana ? " checked" : "") + '> Auto-convert romaji → かな while typing</label>' +
        '</form>';
    }
    var resultLine = s.checkedCorrect ? '<div class="check-result ok">◯ Correct</div>' : '<div class="check-result no">✕ Not quite</div>';
    return img +
      '<div class="answer-input ' + (s.checkedCorrect ? "correct" : "incorrect") + '" style="width:100%;max-width:320px;">' + esc(s.typed) + '</div>' +
      resultLine +
      '<div class="reveal-block"><div class="study-jp">' + esc(card.japanese) + '</div>' +
      (card.reading ? '<div class="study-reading">' + esc(card.reading) + '</div>' : '') +
      '<div class="reveal-meaning">' + esc(card.meaning) + '</div></div>' +
      gradeRowHtml(s.checkedCorrect ? "good" : "again");
  }

  function renderSummary() {
    var s = state.study;
    var correct = s.results.filter(function (r) { return r.correct; }).length;
    var total = s.results.length;
    var acc = total ? Math.round((correct / total) * 100) : 0;
    return (
      '<div class="summary-panel">' +
        '<h1>おつかれさま</h1><p style="color:var(--ink-soft)">Session complete — ' + MODES[s.mode].en + ' mode.</p>' +
        '<div class="summary-stats">' +
          '<div><div class="summary-num">' + total + '</div><div class="summary-label">Reviewed</div></div>' +
          '<div><div class="summary-num">' + acc + '%</div><div class="summary-label">Accuracy</div></div>' +
        '</div>' +
        '<div class="summary-actions">' +
          '<button class="btn btn-primary" data-action="restudy" data-mode="' + s.mode + '">Study again</button>' +
          '<button class="btn btn-ghost" data-action="exit-study">Back home</button>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------- post-render bindings ----------

  function afterRender() {
    if (state.view === "deck") {
      bindImageInput();
    }
    if (state.view === "study" && state.study && state.study.mode === "recall" && !state.study.checked) {
      var input = document.getElementById("answer-input");
      if (input) {
        if (state.autoKana && window.wanakana) wanakana.bind(input);
        input.focus();
      }
    }
  }

  // ---------- actions ----------

  function onFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    state.autoImageToken += 1; // invalidate any in-flight auto-fill
    state.autoImageStatus = null;
    resizeImage(file, 900, 0.85).then(function (blob) {
      return uploadImage(blob);
    }).then(function (res) {
      state.pendingImage = { id: res.id, url: res.url };
      state.selectedSuggestionIndex = null;
      render();
    }).catch(function (err) {
      toast("Couldn't upload image: " + err.message);
    });
  }

  // ---------- automatic card image: search a public API, else draw one ----------

  var AUTO_IMAGE_PALETTE = [
    { bg: "#F1DBCF", fg: "#7A2712" }, // shu
    { bg: "#DCE3EE", fg: "#2B4570" }, // ai
    { bg: "#DEE7D5", fg: "#3F5A33" }, // matcha
    { bg: "#EFE2C2", fg: "#7A5A17" }  // kuchiba
  ];

  function hashString(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // A minimalist "stamped tile" fallback: the word's own characters on a
  // flat paper-toned ground, no external service required.
  function generateMinimalistImage(japanese) {
    var palette = AUTO_IMAGE_PALETTE[hashString(japanese) % AUTO_IMAGE_PALETTE.length];
    var glyph = Array.from(japanese || "?").slice(0, 2).join("");
    var canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 450;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, 600, 450);
    ctx.strokeStyle = palette.fg;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 3;
    ctx.strokeRect(22, 22, 556, 406);
    ctx.globalAlpha = 1;

    var fontLoad = (document.fonts && document.fonts.load)
      ? document.fonts.load('700 220px "Shippori Mincho"').catch(function () {})
      : Promise.resolve();

    return fontLoad.then(function () {
      ctx.fillStyle = palette.fg;
      ctx.font = '700 220px "Shippori Mincho", serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, 300, 240);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("draw failed")); }, "image/jpeg", 0.92);
      });
    });
  }

  // Wikipedia's MediaWiki API is public, keyless, and CORS-enabled via
  // origin=*. Two calls: find several matching articles, then their lead
  // images, so the user gets a handful of real-photo options to pick from.
  function fetchWikipediaSuggestions(query, limit) {
    var signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    var searchUrl = "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=" + limit + "&srsearch=" + encodeURIComponent(query);
    return fetch(searchUrl, { signal: signal }).then(function (r) { return r.json(); }).then(function (data) {
      var titles = ((data.query && data.query.search) || []).map(function (h) { return h.title; });
      if (!titles.length) return [];
      var imgUrl = "https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=300&format=json&origin=*&titles=" + encodeURIComponent(titles.join("|"));
      return fetch(imgUrl, { signal: signal }).then(function (r) { return r.json(); }).then(function (data2) {
        var pages = (data2.query && data2.query.pages) || {};
        var thumbByTitle = {};
        Object.keys(pages).forEach(function (k) {
          var p = pages[k];
          if (p && p.thumbnail && p.thumbnail.source) thumbByTitle[p.title] = p.thumbnail.source;
        });
        return titles.filter(function (t) { return thumbByTitle[t]; })
          .map(function (t) { return { title: t, thumbUrl: thumbByTitle[t] }; });
      });
    });
  }

  function fetchImageBlob(url) {
    var signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    return fetch(url, { signal: signal }).then(function (r) { return r.ok ? r.blob() : null; }).catch(function () { return null; });
  }

  function revokeSuggestionPreviews(suggestions) {
    (suggestions || []).forEach(function (sug) {
      if (sug.type === "generated" && sug.previewUrl) URL.revokeObjectURL(sug.previewUrl);
    });
  }

  // Looks up a handful of candidate images once both words are present: a
  // few real photos matching the meaning, plus a generated minimalist tile
  // as a fallback option. The best match is pre-selected, but the user can
  // tap any suggestion to swap it in. Never overwrites a manually-picked
  // image.
  function autoFillImage() {
    var jp = (document.getElementById("f-jp") || {}).value || "";
    var meaning = (document.getElementById("f-meaning") || {}).value || "";
    jp = jp.trim(); meaning = meaning.trim();
    if (!jp) return;
    if (state.pendingImage && !state.pendingImage.auto) return;

    var query = jp + "|" + meaning;
    if (query === state.lastAutoImageQuery && state.pendingImage) return;
    state.lastAutoImageQuery = query;

    var token = ++state.autoImageToken;
    var stale = function () { return token !== state.autoImageToken; };

    revokeSuggestionPreviews(state.imageSuggestions);
    state.imageSuggestions = null;
    state.selectedSuggestionIndex = null;
    state.autoImageStatus = "searching";
    refreshImgDropOnly();

    var search = meaning ? fetchWikipediaSuggestions(meaning, 5).catch(function () { return []; }) : Promise.resolve([]);

    search.then(function (hits) {
      if (stale()) return null;
      var suggestions = hits.map(function (h) {
        return { type: "photo", title: h.title, thumbUrl: h.thumbUrl, previewUrl: h.thumbUrl, blob: null };
      });
      return generateMinimalistImage(jp).then(function (blob) {
        if (!stale()) suggestions.push({ type: "generated", japanese: jp, previewUrl: URL.createObjectURL(blob), blob: blob });
        return suggestions;
      }).catch(function () { return suggestions; });
    }).then(function (suggestions) {
      if (stale() || !suggestions) return;
      state.imageSuggestions = suggestions;
      state.autoImageStatus = null;
      refreshImgDropOnly();
      if (suggestions.length) selectSuggestion(0);
    }).catch(function () {
      // Silent: manual upload is always still available.
    }).then(function () {
      if (stale()) return;
      state.autoImageStatus = null;
    });
  }

  // Fetches (or reuses a cached) blob for one suggestion and uploads it as
  // the card's image. Guards against races with a fresh word edit by
  // snapshotting the auto-image token and bailing if it moves on.
  function selectSuggestion(index) {
    var sug = state.imageSuggestions && state.imageSuggestions[index];
    if (!sug) return;
    var imageToken = state.autoImageToken;
    var selToken = ++state.suggestionSelectToken; // last click wins over an in-flight one
    var stale = function () { return imageToken !== state.autoImageToken || selToken !== state.suggestionSelectToken; };

    state.suggestionBusyIndex = index;
    refreshImgDropOnly();

    var blobPromise = sug.blob ? Promise.resolve(sug.blob) :
      sug.type === "generated" ? generateMinimalistImage(sug.japanese) :
      fetchImageBlob(sug.thumbUrl).then(function (b) {
        if (!b) throw new Error("no image");
        return resizeImage(b, 900, 0.85);
      });

    blobPromise.then(function (blob) {
      sug.blob = blob;
      if (stale()) return null;
      return uploadImage(blob);
    }).then(function (res) {
      if (stale() || !res) return;
      state.pendingImage = { id: res.id, url: res.url, auto: true };
      state.selectedSuggestionIndex = index;
    }).catch(function () {
      if (!stale()) toast("Couldn't use that photo — try another.");
    }).then(function () {
      if (stale()) return;
      state.suggestionBusyIndex = null;
      refreshImgDropOnly();
    });
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      var args = arguments;
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  var scheduleAutoFillImage = debounce(autoFillImage, 700);

  function resetAutoImageState() {
    state.autoImageToken += 1;
    state.autoImageStatus = null;
    state.lastAutoImageQuery = null;
    revokeSuggestionPreviews(state.imageSuggestions);
    state.imageSuggestions = null;
    state.selectedSuggestionIndex = null;
    state.suggestionBusyIndex = null;
  }

  function resizeImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("resize failed")); }, "image/jpeg", quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
      img.src = url;
    });
  }

  function normalizeKana(s) {
    s = (s || "").trim();
    if (window.wanakana) { try { s = wanakana.toHiragana(s, { passRomaji: true }); } catch (e) {} }
    try { s = s.normalize("NFKC"); } catch (e) {}
    return s;
  }
  function isKanaOnly(s) { return /^[぀-ゟ゠-ヿー・\s]+$/.test(s || ""); }

  function checkRecallAnswer(card, typed) {
    var t = normalizeKana(typed);
    if (!t) return false;
    var candidates = [card.reading, card.japanese].filter(Boolean).map(normalizeKana);
    return candidates.indexOf(t) !== -1;
  }

  function submitGrade(grade) {
    var s = state.study;
    var card = currentCard();
    gradeCard(card.id, grade).then(function (updated) {
      Object.assign(card, updated);
      s.results.push({ id: card.id, correct: grade !== "again" });
      if (grade === "again") {
        var reinsertAt = Math.min(s.pos + 1 + 3, s.queue.length);
        s.queue.splice(reinsertAt, 0, card);
      }
      s.pos += 1;
      s.revealed = false; s.checked = false; s.checkedCorrect = null; s.typed = "";
      render();
    }).catch(function () { toast("Couldn't save that review — try again."); });
  }

  function saveCardFromForm() {
    var jp = document.getElementById("f-jp").value.trim();
    var reading = document.getElementById("f-reading").value.trim();
    var meaning = document.getElementById("f-meaning").value.trim();
    var tags = document.getElementById("f-tags").value.trim();
    var errEl = document.getElementById("form-error");
    errEl.hidden = true;

    if (!jp || !meaning) { errEl.textContent = "Japanese and meaning are both required."; errEl.hidden = false; return; }
    if (!state.pendingImage) { errEl.textContent = "Add an image for this card."; errEl.hidden = false; return; }
    if (!reading && isKanaOnly(jp)) reading = jp;

    var data = { japanese: jp, reading: reading, meaning: meaning, tags: tags, image_id: state.pendingImage.id };
    var request = state.editingId ? updateCard(state.editingId, data) : createCard(data);

    request.then(function (card) {
      if (state.editingId) {
        var idx = state.cards.findIndex(function (c) { return c.id === state.editingId; });
        if (idx !== -1) state.cards[idx] = card;
      } else {
        state.cards.unshift(card);
      }
      toast(state.editingId ? "Card updated" : "Card added");
      resetAutoImageState();
      state.editingId = null;
      state.pendingImage = null;
      render();
    }).catch(function (err) {
      var msg = (err.body && err.body.errors && err.body.errors.join(", ")) || err.message;
      errEl.textContent = msg;
      errEl.hidden = false;
    });
  }

  // ---------- event delegation ----------

  appEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");

    if (action === "nav-home") { state.view = "home"; render(); }
    else if (action === "nav-deck") { resetAutoImageState(); state.editingId = null; state.pendingImage = null; state.view = "deck"; render(); }
    else if (action === "start-study" || action === "restudy") { startStudy(btn.getAttribute("data-mode")); }
    else if (action === "exit-study") { endStudy(); }
    else if (action === "reveal") { state.study.revealed = true; render(); }
    else if (action === "grade") { submitGrade(btn.getAttribute("data-grade")); }
    else if (action === "remove-image") { state.pendingImage = null; state.selectedSuggestionIndex = null; state.autoImageToken += 1; render(); }
    else if (action === "select-suggestion") { selectSuggestion(parseInt(btn.getAttribute("data-index"), 10)); }
    else if (action === "sign-out") { signOut(); }
    else if (action === "edit-card") {
      var id = btn.getAttribute("data-id");
      var c = state.cards.find(function (x) { return x.id === id; });
      if (c) {
        resetAutoImageState();
        state.editingId = id;
        state.pendingImage = c.image_id ? { id: c.image_id, url: c.image_url } : null;
        render();
        var f = document.getElementById("card-form");
        if (f) f.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    else if (action === "cancel-edit") { resetAutoImageState(); state.editingId = null; state.pendingImage = null; render(); }
    else if (action === "delete-card") {
      var did = btn.getAttribute("data-id");
      if (confirm("Delete this card? This can't be undone.")) {
        deleteCard(did).then(function () {
          state.cards = state.cards.filter(function (c) { return c.id !== did; });
          render();
        }).catch(function () { toast("Couldn't delete that card."); });
      }
    }
  });

  appEl.addEventListener("submit", function (e) {
    if (e.target.id === "card-form") { e.preventDefault(); saveCardFromForm(); }
    if (e.target.id === "answer-form") {
      e.preventDefault();
      var input = document.getElementById("answer-input");
      var typed = input.value;
      var s = state.study;
      s.typed = typed;
      s.checked = true;
      s.checkedCorrect = checkRecallAnswer(currentCard(), typed);
      render();
    }
  });

  appEl.addEventListener("change", function (e) {
    if (e.target.id === "home-tag-filter") { state.filterTag = e.target.value; render(); }
    if (e.target.id === "home-due-toggle") { state.dueOnly = e.target.checked; render(); }
    if (e.target.id === "deck-tag-filter") { state.filterTag = e.target.value; refreshDeckListOnly(); }
    if (e.target.id === "kana-toggle") {
      state.autoKana = e.target.checked;
      writeLocal("tangochou_autokana", state.autoKana);
      var input = document.getElementById("answer-input");
      if (input && window.wanakana) { if (state.autoKana) wanakana.bind(input); else wanakana.unbind(input); }
    }
  });

  appEl.addEventListener("input", function (e) {
    if (e.target.id === "deck-search") refreshDeckListOnly();
    if (e.target.id === "f-jp" || e.target.id === "f-meaning") scheduleAutoFillImage();
  });

  appEl.addEventListener("keydown", function (e) {
    if (state.view !== "study" || !state.study) return;
    var active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    var s = state.study;
    if (s.pos >= s.queue.length) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (s.mode !== "recall" && !s.revealed) { s.revealed = true; render(); }
    } else if (["1", "2", "3", "4"].indexOf(e.key) !== -1) {
      var canGrade = (s.mode === "recall" && s.checked) || (s.mode !== "recall" && s.revealed);
      if (canGrade) submitGrade({ "1": "again", "2": "hard", "3": "good", "4": "easy" }[e.key]);
    }
  });

  function refreshDeckListOnly() {
    var el = document.getElementById("deck-list");
    if (el) el.innerHTML = renderDeckListItemsHTML();
  }

  // ---------- init ----------

  render();
  loadCards().then(function (cards) {
    state.cards = cards;
    state.loaded = true;
    render();
  }).catch(function () {
    toast("Couldn't load your deck.");
    state.loaded = true;
    render();
  });
})();
