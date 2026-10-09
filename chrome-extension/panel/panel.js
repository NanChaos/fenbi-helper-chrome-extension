/**
 * 粉笔刷题 · 侧边栏主界面
 * 视图：选题（考点/历史） / 做题 / 我的（登录+设置）
 */
var $ = function (id) {
  return document.getElementById(id);
};

var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

var state = {
  user: null,
  courses: [],
  course: null,
  examCatId: null,
  tree: [],
  keypointId: null,
  exercise: null,
  meta: null,
  questions: [],
  answers: {},
  startAt: {},
  submitted: false,
  solutions: null,
  qMeta: {},
  histItems: [],
  histCursor: '',
  histLoaded: false,
  theme: '', // ''=跟随系统 light=浅色 dark=深色（镜像 settings.appearance.theme）
  // AI 解析：{ [globalId]: { text, open, loading, err, controller } }
  ai: {},
  // 登录
  lgtoken: null,
  pollTimer: null,
  expireTimer: null,
};

/** 全局设置（外观 + AI），由 options 页写入 chrome.storage.local.fenbiSettings */
var settings = FenbiAI.defaultSettings();

// ---------- 工具 ----------

function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () {
    t.classList.remove('show');
  }, 1800);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/** 协议相对 URL 在扩展页面下会失效，补 https */
function fixHtml(html) {
  if (!html) return '';
  return String(html).replace(/(<img[^>]*?src\s*=\s*["'])\/\//gi, '$1https://');
}

function typeName(t) {
  return { 1: '单选题', 2: '多选题', 3: '判断题', 4: '填空题', 5: '简答题', 6: '材料题' }[t] || '题目';
}

function fmtTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var p = function (n) {
    return n < 10 ? '0' + n : '' + n;
  };
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------- 主题 ----------
// 默认 '' = 跟随系统：不给 <html> 写 data-theme，由 CSS 的
// @media (prefers-color-scheme: dark) 自动决定，系统/浏览器切主题时实时生效。

var THEMES = ['', 'light', 'dark'];
var THEME_META = {
  '': { icon: '🌓', label: '跟随系统' },
  light: { icon: '☀️', label: '浅色' },
  dark: { icon: '🌙', label: '深色' },
};
var DARK_MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** 实际生效的深浅（跟随系统时按媒体查询解析） */
function resolvedDark() {
  return state.theme ? state.theme === 'dark' : !!(DARK_MQ && DARK_MQ.matches);
}

function applyTheme(t) {
  settings.appearance.theme = THEMES.indexOf(t) >= 0 ? t : '';
  applyAppearance();
  saveSettings();
}

/** 把 settings.appearance 落到 <html>（主题模式 + 主题色），并刷新顶栏按钮 */
function applyAppearance() {
  state.theme = settings.appearance.theme || '';
  FenbiAI.applyAppearance(settings);
  renderThemeBtn();
}

function saveSettings() {
  chrome.storage.local.set({ fenbiSettings: settings });
}

function renderThemeBtn() {
  var btn = $('btnTheme');
  if (!btn) return;
  var m = THEME_META[state.theme];
  var dark = resolvedDark();
  // 跟随系统时图标跟着实际深浅走，一眼能看出当前是哪套
  btn.textContent = state.theme ? m.icon : dark ? '🌙' : '☀️';
  btn.title =
    '主题：' + m.label + (state.theme ? '' : '（当前' + (dark ? '深色' : '浅色') + '）') + ' — 点击切换';
}

function cycleTheme() {
  applyTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length]);
}

/** 跟随系统模式下，系统主题一变就刷新按钮提示（配色由 CSS 自动处理） */
function watchSystemTheme() {
  if (!DARK_MQ) return;
  var onChange = function () {
    renderThemeBtn();
  };
  if (DARK_MQ.addEventListener) DARK_MQ.addEventListener('change', onChange);
  else if (DARK_MQ.addListener) DARK_MQ.addListener(onChange);
}

/** 选项页改动设置 → 侧边栏即时生效 */
function watchSettings() {
  if (!chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.fenbiSettings) return;
    settings = FenbiAI.mergeSettings(changes.fenbiSettings.newValue);
    applyAppearance();
  });
}

function switchView(name) {
  ['pick', 'quiz'].forEach(function (v) {
    $('view' + v.charAt(0).toUpperCase() + v.slice(1)).hidden = v !== name;
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tabs .tab'), function (t) {
    t.classList.toggle('active', t.dataset.view === name);
  });
}

// ---------- 初始化 ----------

function init() {
  chrome.storage.local.get(
    ['fenbiUser', 'fenbiCourse', 'fenbiExamCatId', 'fenbiDefaultCourse', 'fenbiTheme', 'fenbiSettings'],
    function (r) {
      settings = FenbiAI.mergeSettings(r.fenbiSettings);
      // 兼容 0.6.x：主题当时存在单独的 fenbiTheme 键
      if (!r.fenbiSettings && r.fenbiTheme) settings.appearance.theme = r.fenbiTheme;
      applyAppearance();
      watchSystemTheme();
      watchSettings();
      state.user = r.fenbiUser;
      state.course = r.fenbiDefaultCourse || r.fenbiCourse;
      state.examCatId = r.fenbiExamCatId;

    FenbiAPI.getUserCurrent()
      .then(function (user) {
        if (!user) throw new Error('NOT_LOGIN');
        state.user = user;
        chrome.storage.local.set({ fenbiUser: user });
        return FenbiAPI.getExamCategory();
      })
      .then(function (cat) {
        state.courses = cat.courses || [];
        state.examCatId = cat.examCategoryId;
        var ok =
          state.course &&
          state.courses.some(function (x) {
            return x.prefix === state.course.prefix;
          });
        if (!ok) state.course = cat.currentCourse || state.courses[0];
        chrome.storage.local.set({
          fenbiCourse: state.course,
          fenbiDefaultCourse: state.course,
          fenbiExamCatId: state.examCatId,
        });
        renderCourseSel();
        renderMe();
        loadTree();
      })
      .catch(function () {
        state.user = null;
        chrome.storage.local.remove(['fenbiUser']);
        renderMe();
        showLogin();
      });
    }
  );
}

function renderCourseSel() {
  var sel = $('courseSel');
  sel.innerHTML = '';
  state.courses.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c.prefix;
    o.textContent = c.name;
    if (state.course && c.prefix === state.course.prefix) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = function () {
    setCourse(
      state.courses.filter(function (x) {
        return x.prefix === sel.value;
      })[0]
    );
  };
}

function setCourse(c) {
  if (!c) return;
  state.course = c;
  // 顶栏科目即「默认科目」：切换后记住，下次打开侧边栏自动生效
  chrome.storage.local.set({ fenbiCourse: c, fenbiDefaultCourse: c });
  state.histLoaded = false;
  state.histItems = [];
  $('paneHist').innerHTML = '';
  loadTree();
}

// ---------- 登录 ----------

function showLogin() {
  $('meBox').innerHTML =
    '<div style="text-align:center">' +
    '<div style="font-weight:600;margin-bottom:2px">粉笔扫码登录</div>' +
    '<div class="muted small">用粉笔 App 扫描下方二维码</div>' +
    '<div id="qrcode"></div>' +
    '<div class="small muted" id="loginStatus">正在生成二维码…</div>' +
    '<div id="loginRefresh" class="linkbtn" hidden>点击刷新二维码</div>' +
    '</div>';
  $('loginRefresh').onclick = startQR;
  $('modal').hidden = false;
  startQR();
}

function hideModal() {
  $('modal').hidden = true;
  stopPoll();
}

function startQR() {
  stopPoll();
  $('loginRefresh').hidden = true;
  $('loginStatus').innerHTML = '<span class="spin"></span> 正在生成二维码…';
  FenbiAPI.genLoginQR()
    .then(function (data) {
      state.lgtoken = data.lgtoken;
      $('qrcode').innerHTML = '';
      new QRCode($('qrcode'), {
        text: data.codeContent,
        width: 170,
        height: 170,
        correctLevel: QRCode.CorrectLevel.M,
      });
      $('loginStatus').textContent = '等待扫码…';
      state.expireTimer = setTimeout(function () {
        stopPoll();
        $('loginStatus').textContent = '二维码已过期';
        $('loginRefresh').hidden = false;
      }, 100000);
      state.pollTimer = setInterval(pollLogin, 2500);
    })
    .catch(function (e) {
      $('loginStatus').textContent = '生成失败：' + (e.message || e);
      $('loginRefresh').hidden = false;
    });
}

function stopPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.expireTimer) clearTimeout(state.expireTimer);
  state.pollTimer = state.expireTimer = null;
}

function pollLogin() {
  if (!state.lgtoken) return;
  FenbiAPI.queryLoginStatus(state.lgtoken)
    .then(function (res) {
      var s = res && res.data;
      if (s === 3) {
        stopPoll();
        $('loginStatus').textContent = '登录成功…';
        setTimeout(hideModal, 400);
        onLoginSuccess();
      } else if (s === 2) {
        $('loginStatus').textContent = '已扫码，请在 App 上确认…';
      }
    })
    .catch(function () {});
}

function onLoginSuccess() {
  FenbiAPI.getUserCurrent()
    .then(function (user) {
      if (!user) throw new Error('校验失败');
      state.user = user;
      return FenbiAPI.getExamCategory().then(function (cat) {
        state.courses = cat.courses || [];
        state.examCatId = cat.examCategoryId;
        // 尊重已保存的默认科目，否则用服务端当前科目
        var saved = state.course;
        var still = saved && state.courses.some(function (x) { return x.prefix === saved.prefix; });
        state.course = still ? saved : cat.currentCourse || state.courses[0];
        chrome.storage.local.set({
          fenbiUser: user,
          fenbiCourse: state.course,
          fenbiDefaultCourse: state.course,
          fenbiExamCatId: state.examCatId,
        });
        renderCourseSel();
        renderMe();
        loadTree();
        switchView('pick');
        toast('登录成功');
      });
    })
    .catch(function (e) {
      $('loginStatus').textContent = '初始化失败：' + (e.message || e);
    });
}

/** 顶栏账号区：昵称 + 退出 / 登录 按钮 */
function renderMe() {
  var u = state.user;
  $('dot').className = 'dot' + (u ? ' on' : '');
  $('btnLogin').hidden = !!u;
  $('btnLogout').hidden = !u;
  var el = $('acctName');
  el.hidden = !u;
  if (!u) return;
  var name = u.nickname || u.identity || u.phone || '用户' + u.id;
  el.textContent = name;
  el.title = 'ID ' + u.id + ' · ' + name + '（点击复制 ID）';
  el.onclick = function () {
    if (navigator.clipboard) navigator.clipboard.writeText(String(u.id));
    toast('已复制用户 ID');
  };
}

// ---------- 考点树 ----------

function loadTree() {
  if (!state.course) return;
  $('paneTree').innerHTML = '<div class="muted small"><span class="spin"></span> 加载考点…</div>';
  FenbiAPI.getKeypointTree(state.course.prefix, state.examCatId)
    .then(function (tree) {
      state.tree = tree;
      $('paneTree').innerHTML = '';
      tree.forEach(function (n) {
        $('paneTree').appendChild(buildNode(n));
      });
    })
    .catch(function (e) {
      $('paneTree').innerHTML = '<div class="msg err">' + (e.message || '加载失败') + '</div>';
    });
}

function buildNode(node) {
  var wrap = document.createElement('div');
  var row = document.createElement('div');
  row.className = 'node';
  row.innerHTML =
    '<span>' + esc(node.name) + '</span><span class="n">' + (node.answerCount || 0) + '/' + (node.count || 0) + '</span>';
  wrap.appendChild(row);
  var leaf = !node.children || !node.children.length;
  row.onclick = function () {
    if (leaf) return startExercise(node);
    var box = wrap.querySelector('.children');
    if (box) {
      box.hidden = !box.hidden;
      return;
    }
    box = document.createElement('div');
    box.className = 'children';
    node.children.forEach(function (n) {
      box.appendChild(buildNode(n));
    });
    wrap.appendChild(box);
  };
  return wrap;
}

// ---------- 历史 ----------

function loadHistory(reset) {
  if (reset) {
    state.histItems = [];
    state.histCursor = '';
  }
  $('paneHist').innerHTML = '<div class="muted small"><span class="spin"></span> 加载历史…</div>';
  FenbiAPI.getHistory(state.course.prefix, 20, state.histCursor)
    .then(function (res) {
      state.histLoaded = true;
      state.histItems = state.histItems.concat(res.items);
      state.histCursor = res.cursor || '';
      renderHistory();
    })
    .catch(function (e) {
      $('paneHist').innerHTML = '<div class="msg err">' + (e.message || '加载失败') + '</div>';
    });
}

function renderHistory() {
  if (!state.histItems.length) {
    $('paneHist').innerHTML = '<div class="muted small">暂无记录</div>';
    return;
  }
  $('paneHist').innerHTML =
    state.histItems
      .map(function (it, i) {
        var done = it.status !== 0;
        var rate = it.questionCount ? Math.round((it.correctCount / it.questionCount) * 100) + '%' : '-';
        return (
          '<div class="hist-item" data-i="' +
          i +
          '"><div class="hist-name">' +
          esc(it.sheetName || '练习') +
          '</div><div class="hist-meta">' +
          (done ? '<span class="badge done">已完成</span>' : '<span class="badge undone">未交卷</span>') +
          '<span>' + (it.questionCount || 0) + '题</span><span>正确 ' + rate + '</span>' +
          '<span>' + fmtTime(it.updatedTime) + '</span></div></div>'
        );
      })
      .join('') + (state.histCursor ? '<button class="linkbtn" id="moreHist">加载更多</button>' : '');
  Array.prototype.forEach.call($('paneHist').querySelectorAll('.hist-item'), function (el) {
    el.onclick = function () {
      openHistory(state.histItems[Number(el.dataset.i)]);
    };
  });
  var more = $('moreHist');
  if (more) more.onclick = function () { loadHistory(false); };
}

// ---------- 练习 ----------

function startExercise(node) {
  if (!confirmNew()) return;
  state.keypointId = node.id;
  prepareQuiz('正在生成「' + esc(node.name) + '」…', node.name);
  FenbiAPI.createExercise(state.course.prefix, node.id, 3)
    .then(function (ex) {
      beginExercise(ex, node.name);
      return loadExercise(ex.key);
    })
    .catch(function (e) {
      failQuiz(e, '创建练习失败');
    });
}

/** ⚡ 快速智能练习：不传 keypointId，全科目混合 15 题 */
function startQuick() {
  if (!confirmNew()) return;
  state.keypointId = null;
  prepareQuiz('正在生成快速练习…', '快速智能练习');
  FenbiAPI.createExercise(state.course.prefix, null, 3)
    .then(function (ex) {
      beginExercise(ex, '快速智能练习');
      return loadExercise(ex.key);
    })
    .catch(function (e) {
      failQuiz(e, '创建快速练习失败');
    });
}

// ---------- 练习加载公共流程 ----------

function confirmNew() {
  if (state.exercise && !state.submitted && !confirm('当前练习未交卷，开始新练习将放弃进度，继续？')) return false;
  return true;
}

function prepareQuiz(loadingText, name) {
  switchView('quiz');
  $('content').innerHTML = '<div class="empty"><span class="spin"></span> ' + loadingText + '</div>';
  $('btnSubmit').hidden = true;
  $('btnAgain').hidden = true;
  $('btnToggleSol').hidden = true;
  $('exerciseName').textContent = name;
}

function beginExercise(ex, fallbackName) {
  state.exercise = ex;
  state.answers = {};
  state.startAt = {};
  state.solutions = null;
  state.submitted = false;
  resetAi(); // 换练习就丢掉上一套的 AI 解析缓存
  $('exerciseName').textContent = (ex.sheet && ex.sheet.name) || fallbackName;
}

/** 清空 AI 解析缓存（并中断仍在生成的请求） */
function resetAi() {
  for (var k in state.ai) {
    if (!Object.prototype.hasOwnProperty.call(state.ai, k)) continue;
    var st = state.ai[k];
    if (st && st.loading && st.controller) st.controller.abort();
  }
  state.ai = {};
}

/** 拿到 key 后：getExercise → static/exercise → 渲染（未交卷练习走这条） */
function loadExercise(key) {
  return FenbiAPI.getExercise(state.course.prefix, key)
    .then(function (meta) {
      state.meta = meta;
      return FenbiAPI.getQuestions(state.course.prefix, meta.switchVO.requestKey, state.examCatId);
    })
    .then(function (qs) {
      fillQuestions(qs.questions || []);
      $('btnSubmit').hidden = false;
      toast('共 ' + state.questions.length + ' 题');
    });
}

function failQuiz(e, what) {
  $('content').innerHTML = '<div class="empty msg err">' + (e.message || what) + '</div>';
}

function openHistory(item) {
  if (!item) return;
  var finished = item.status !== 0;
  switchView('quiz');
  $('content').innerHTML = '<div class="empty"><span class="spin"></span> 正在打开…</div>';
  $('btnSubmit').hidden = true;
  $('btnAgain').hidden = true;
  $('btnToggleSol').hidden = true;
  state.exercise = { key: item.exerciseKey };
  state.answers = {};
  state.solutions = null;
  state.submitted = finished;
  resetAi();
  $('exerciseName').textContent = item.sheetName || '练习';

  if (finished) {
    // 已交卷：getExercise 的 requestKey 已失效（static/exercise 会报 invalid request key），
    // 必须走 solution 链路 —— getSolution 自带 userAnswers，static/solution 含题目+答案+解析
    loadSolutions(true)
      .then(function () {
        $('btnAgain').hidden = false;
        $('btnToggleSol').hidden = false;
      })
      .catch(function (e) {
        $('content').innerHTML = '<div class="empty msg err">' + (e.message || '打开失败') + '</div>';
      });
    return;
  }

  // 未交卷：续做
  loadExercise(item.exerciseKey).catch(function (e) {
    $('content').innerHTML = '<div class="empty msg err">' + (e.message || '打开失败') + '</div>';
  });
}

function fillQuestions(list) {
  state.questions = list;
  var saved = (state.meta && state.meta.userAnswers) || {};
  state.questions.forEach(function (q) {
    var a = saved[q.globalId];
    if (a && a.answer) state.answers[q.globalId] = a.answer.choice;
    state.startAt[q.globalId] = Date.now();
  });
  renderQuestions();
}

function renderQuestions() {
  $('content').innerHTML = state.questions
    .map(function (q, i) {
      var opts = (q.accessories && q.accessories[0] && q.accessories[0].options) || [];
      var picked = state.answers[q.globalId];
      return (
        '<div class="q" data-key="' + q.globalId + '" data-id="' + q.id + '">' +
        '<div class="q-head"><span class="idx">' + (i + 1) + '</span><span class="tag">' + typeName(q.type) + '</span></div>' +
        '<div class="q-content">' + fixHtml(q.content) + '</div>' +
        '<ul class="opts' + (state.submitted ? ' locked' : '') + '">' +
        opts
          .map(function (o, k) {
            return (
              '<li data-choice="' + k + '" class="' + (String(picked) === String(k) ? 'picked' : '') + '">' +
              '<span class="letter">' + (LETTERS[k] || k + 1) + '</span><span class="text">' + fixHtml(o) + '</span></li>'
            );
          })
          .join('') +
        '</ul><div class="sol-slot"></div></div>'
      );
    })
    .join('');

  updateProgress();
  if (state.submitted) return;
  Array.prototype.forEach.call($('content').querySelectorAll('.opts li'), function (li) {
    li.onclick = function () {
      var qEl = li.closest('.q');
      Array.prototype.forEach.call(qEl.querySelectorAll('.opts li'), function (x) {
        x.classList.remove('picked');
      });
      li.classList.add('picked');
      pick(qEl.dataset.key, qEl.dataset.id, li.dataset.choice);
    };
  });
}

function pick(globalId, qid, choice) {
  state.answers[globalId] = choice;
  updateProgress();
  var sec = Math.round((Date.now() - (state.startAt[globalId] || Date.now())) / 1000);
  FenbiAPI.submitAnswers(state.course.prefix, state.exercise.key, [
    { key: globalId, id: Number(qid), prefix: state.course.prefix, answer: { choice: String(choice), type: 201 }, time: sec },
  ]).catch(function (e) {
    toast('提交失败：' + (e.message || e));
  });
}

function updateProgress() {
  var done = state.questions.filter(function (q) {
    return state.answers[q.globalId] !== undefined;
  }).length;
  $('progress').textContent = state.questions.length ? done + '/' + state.questions.length : '';
}

// ---------- 交卷 & 解析 ----------

function doSubmit() {
  var un = state.questions.filter(function (q) {
    return state.answers[q.globalId] === undefined;
  }).length;
  if (un && !confirm('还有 ' + un + ' 题未作答，确定交卷？')) return;

  $('btnSubmit').disabled = true;
  FenbiAPI.submitExercise(state.course.prefix, state.exercise.key, state.examCatId)
    .then(function () {
      state.submitted = true;
      return loadSolutions();
    })
    .then(function () {
      $('btnSubmit').hidden = true;
      $('btnAgain').hidden = false;
      $('btnSubmit').disabled = false;
      $('btnToggleSol').hidden = false;
    })
    .catch(function (e) {
      $('btnSubmit').disabled = false;
      toast('交卷失败：' + (e.message || e));
    });
}

/**
 * 拉取解析
 * @param {boolean} standalone true=题目也来自解析（打开已交卷的历史练习时用）
 */
function loadSolutions(standalone) {
  return FenbiAPI.getSolution(state.course.prefix, state.exercise.key)
    .then(function (solMeta) {
      state.meta = solMeta; // getSolution 的 data 自带 userAnswers
      var reqKey = solMeta.switchVO && solMeta.switchVO.requestKey;
      return Promise.all([
        FenbiAPI.getSolutionContent(state.course.prefix, reqKey, state.examCatId),
        FenbiAPI.getQuestionMeta(state.course.prefix, reqKey),
      ]);
    })
    .then(function (res) {
      state.solutions = res[0].solutions || [];
      state.qMeta = res[1] || {};
      if (standalone) {
        // 已交卷的练习拿不到 static/exercise，题目直接从解析里还原（含 content + options）
        state.questions = state.solutions.map(function (s) {
          return {
            id: s.id,
            globalId: s.globalId,
            type: s.type,
            content: s.content,
            accessories: s.accessories,
          };
        });
        var ua = (state.meta && state.meta.userAnswers) || {};
        state.answers = {};
        state.questions.forEach(function (q) {
          var a = ua[q.globalId];
          if (a && a.answer) state.answers[q.globalId] = a.answer.choice;
        });
        state.submitted = true;
        renderQuestions();
      }
      renderSolutions();
      updateToggleLabel();
    });
}

function renderSolutions() {
  var map = {};
  state.solutions.forEach(function (s) {
    map[s.globalId] = s;
  });
  state.questions.forEach(function (q) {
    var el = $('content').querySelector('.q[data-key="' + q.globalId + '"]');
    if (!el) return;
    var s = map[q.globalId] || {};
    var correct = s.correctAnswer && s.correctAnswer.choice;
    var mine = state.answers[q.globalId];
    var meta = state.qMeta[q.globalId] || {};

    Array.prototype.forEach.call(el.querySelectorAll('.opts li'), function (li) {
      li.classList.remove('picked');
      if (String(li.dataset.choice) === String(correct)) li.classList.add('right');
      else if (String(mine) === String(li.dataset.choice)) li.classList.add('wrong');
    });
    el.querySelector('.opts').classList.add('locked');

    var ok = String(mine) === String(correct);
    var unanswered = mine === undefined || mine === null || mine === '';
    var verdict = unanswered
      ? '<span class="verdict none">未作答</span>'
      : ok
      ? '<span class="verdict ok">答对</span>'
      : '<span class="verdict no">答错</span>';
    var ansTxt = LETTERS[Number(correct)] || correct || '-';
    var kps = (s.keypoints || [])
      .map(function (k) {
        return k.name;
      })
      .join('、');

    el.querySelector('.sol-slot').innerHTML =
      '<div class="sol">' +
      '<div class="sol-head">' +
      '<span>答案 <b>' + esc(ansTxt) + '</b></span>' +
      verdict +
      '<span class="muted small">' + (meta.correctRatio ? meta.correctRatio.toFixed(1) + '%' : '') + '</span>' +
      (meta.mostWrongAnswer ? '<span class="muted small">易错 ' + LETTERS[Number(meta.mostWrongAnswer.choice)] + '</span>' : '') +
      '<span class="grow"></span>' +
      '<button class="ai-sol" title="用 AI 重新讲一遍这道题">✨ AI 解析</button>' +
      '<button class="toggle-sol">查看解析</button>' +
      '</div>' +
      '<div class="sol-body" hidden>' +
      '<div class="label">解析</div>' +
      '<div>' + fixHtml(s.solution) + '</div>' +
      (kps ? '<div class="muted small" style="margin-top:6px">考点：' + esc(kps) + '</div>' : '') +
      (s.source ? '<div class="muted small" style="margin-top:6px">来源：' + esc(s.source) + '</div>' : '') +
      '</div>' +
      '<div class="ai-body" hidden></div>' +
      '</div>';

    var btn = el.querySelector('.toggle-sol');
    if (btn) {
      btn.onclick = function () {
        var body = el.querySelector('.sol-body');
        body.hidden = !body.hidden;
        btn.textContent = body.hidden ? '查看解析' : '收起解析';
        updateToggleLabel();
      };
    }

    (function (gid) {
      var aiBtn = el.querySelector('.ai-sol');
      if (aiBtn) aiBtn.onclick = function () { toggleAI(el, gid); };
    })(q.globalId);

    restoreAi(el, q.globalId);
  });
  updateToggleLabel();
}

// ---------- AI 解析 ----------

function findQuestion(gid) {
  for (var i = 0; i < state.questions.length; i++) {
    if (state.questions[i].globalId === gid) return state.questions[i];
  }
  return null;
}

function findSolution(gid) {
  if (!state.solutions) return null;
  for (var i = 0; i < state.solutions.length; i++) {
    if (state.solutions[i].globalId === gid) return state.solutions[i];
  }
  return null;
}

/** HTML → 纯文本（喂给 AI 用，省 token 也避免干扰） */
function plainText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 极简 Markdown → HTML（AI 输出已经 esc 过） */
function mdToHtml(md) {
  var lines = String(md || '').split('\n');
  var out = [];
  var inCode = false;
  var inList = false;

  function closeList() {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }

  function inline(t) {
    return esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (/^\s*```/.test(raw)) {
      closeList();
      if (!inCode) {
        out.push('<pre class="ai-code">');
        inCode = true;
      } else {
        out.push('</pre>');
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      out.push(esc(raw));
      continue;
    }
    var line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      closeList();
      out.push('<div class="ai-h">' + inline(line.replace(/^#{1,4}\s+/, '')) + '</div>');
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.、)]\s+/.test(line)) {
      var item = line.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+[.、)]\s+/, '');
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push('<li>' + inline(item) + '</li>');
      continue;
    }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  }
  if (inCode) out.push('</pre>');
  closeList();
  return out.join('');
}

function aiReady() {
  var ai = settings.ai;
  var p = FenbiAI.providerOf(ai.provider);
  var needKey = !(p && p.optionalKey);
  return {
    ok: !!FenbiAI.normalizeBaseUrl(ai.baseUrl) && !!ai.model && (!needKey || !!ai.apiKey),
    needKey: needKey,
  };
}

/** 构造给 AI 的上下文 */
function buildAiMessages(gid) {
  var q = findQuestion(gid) || {};
  var s = findSolution(gid) || {};
  var acc = (q.accessories && q.accessories[0]) || (s.accessories && s.accessories[0]);
  var opts = (acc && acc.options) || [];
  var correct = s.correctAnswer && s.correctAnswer.choice;
  var mine = state.answers[gid];

  var lines = [];
  lines.push('【题型】' + typeName(q.type || s.type));
  lines.push('【题目】\n' + plainText(q.content || s.content));
  if (opts.length) {
    lines.push(
      '【选项】\n' +
        opts
          .map(function (o, i) {
            return (LETTERS[i] || i + 1) + '. ' + plainText(o);
          })
          .join('\n')
    );
  }
  if (correct !== undefined && correct !== null && correct !== '') {
    lines.push('【正确答案】' + (LETTERS[Number(correct)] || correct));
  }
  lines.push(
    '【我的答案】' +
      (mine === undefined || mine === null || mine === ''
        ? '未作答'
        : LETTERS[Number(mine)] || mine)
  );
  var kps = (s.keypoints || [])
    .map(function (k) {
      return k.name;
    })
    .join('、');
  if (kps) lines.push('【考点】' + kps);
  if (settings.ai.useOfficial && s.solution) {
    lines.push('【官方解析（仅供参考，请批判吸收）】\n' + plainText(s.solution));
  }

  return [
    { role: 'system', content: settings.ai.systemPrompt || FenbiAI.DEFAULT_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}

/** 重绘题目后恢复已有 AI 内容（含流式进行中的状态） */
function restoreAi(el, gid) {
  var st = state.ai[gid];
  var body = el.querySelector('.ai-body');
  var btn = el.querySelector('.ai-sol');
  if (!body || !btn || !st) return;

  if (st.loading) {
    body.hidden = false;
    body.innerHTML =
      '<div class="ai-head"><span class="ai-tag">AI 解析</span>' +
      '<span class="muted small">生成中…</span></div><div class="ai-text"></div>';
    if (st.text) body.querySelector('.ai-text').innerHTML = mdToHtml(st.text);
    btn.textContent = '停止';
    btn.classList.add('running');
    return;
  }
  if (st.err) {
    body.hidden = false;
    body.innerHTML =
      '<div class="ai-head"><span class="ai-tag">AI 解析</span></div>' +
      '<div class="msg err">' + esc(st.err) + '</div>' +
      (st.text ? '<div class="ai-text">' + mdToHtml(st.text) + '</div>' : '');
    btn.textContent = '重试';
    return;
  }
  if (st.text) {
    body.hidden = !st.open;
    body.innerHTML =
      '<div class="ai-head"><span class="ai-tag">AI 解析</span>' +
      '<span class="muted small">AI 生成，仅供参考</span></div>' +
      '<div class="ai-text">' + mdToHtml(st.text) + '</div>';
    btn.textContent = st.open ? '收起 AI 解析' : '✨ AI 解析';
  }
}

function toggleAI(el, gid) {
  var st = state.ai[gid] || (state.ai[gid] = { text: '', open: false, loading: false, err: '' });
  var body = el.querySelector('.ai-body');
  var btn = el.querySelector('.ai-sol');
  if (!body || !btn) return;

  if (st.loading) {
    if (st.controller) st.controller.abort();
    return;
  }
  if (!st.text || st.err) {
    runAI(el, gid);
    return;
  }
  st.open = !st.open;
  body.hidden = !st.open;
  btn.textContent = st.open ? '收起 AI 解析' : '✨ AI 解析';
}

function runAI(el, gid) {
  var r = aiReady();
  if (!r.ok) {
    toast('请先在设置里配置 AI');
    if (confirm('尚未配置 AI（平台 / API 地址 / Key / 模型），现在打开设置页？')) {
      chrome.runtime.openOptionsPage();
    }
    return;
  }

  var ai = settings.ai;
  var st = state.ai[gid] || (state.ai[gid] = {});
  st.loading = true;
  st.open = true;
  st.err = '';
  st.text = '';

  var body = el.querySelector('.ai-body');
  var btn = el.querySelector('.ai-sol');
  body.hidden = false;
  body.innerHTML =
    '<div class="ai-head"><span class="ai-tag">AI 解析</span>' +
    '<span class="muted small">生成中…</span></div>' +
    '<div class="ai-text"><span class="spin"></span></div>';
  btn.textContent = '停止';
  btn.classList.add('running');

  // 跨域请求需要 host 权限；没拿到就提示去设置页授权
  FenbiAI.ensurePermission(ai.baseUrl).then(function (perm) {
    if (!perm.ok) {
      finishAI(el, gid, '', '未获得访问 ' + (perm.origin || ai.baseUrl) + ' 的权限，请到设置页点「保存」授权');
      return;
    }
    startAiStream(el, gid);
  });
}

function startAiStream(el, gid) {
  var ai = settings.ai;
  var st = state.ai[gid] || (state.ai[gid] = {});
  var body = el.querySelector('.ai-body');
  var btn = el.querySelector('.ai-sol');
  if (!body || !btn) return;
  var out = body.querySelector('.ai-text');
  var ctrl = new AbortController();
  st.controller = ctrl;
  var timer = setTimeout(function () {
    ctrl.abort();
  }, (ai.timeoutSec || 90) * 1000);

  var acc = '';
  FenbiAI.chatStream(
    ai,
    buildAiMessages(gid),
    function (delta) {
      acc += delta;
      st.text = acc;
      if (out && out.isConnected) out.innerHTML = mdToHtml(acc);
    },
    ctrl.signal
  )
    .then(function () {
      clearTimeout(timer);
      finishAI(el, gid, acc, '');
    })
    .catch(function (e) {
      clearTimeout(timer);
      var msg = e && e.name === 'AbortError' ? '已停止' : (e && e.message) || String(e);
      finishAI(el, gid, acc, msg);
    });
}

function finishAI(el, gid, acc, err) {
  var st = state.ai[gid];
  if (!st) return;
  st.loading = false;
  st.controller = null;
  var body = el.querySelector('.ai-body');
  var btn = el.querySelector('.ai-sol');
  if (!body || !btn) return;
  btn.classList.remove('running');

  if (err) {
    st.err = err;
    st.text = acc;
    body.hidden = false;
    body.innerHTML =
      '<div class="ai-head"><span class="ai-tag">AI 解析</span></div>' +
      '<div class="msg err">' + esc(err) + '</div>' +
      (acc ? '<div class="ai-text">' + mdToHtml(acc) + '</div>' : '');
    btn.textContent = '重试';
    return;
  }

  st.text = acc;
  st.open = true;
  body.hidden = false;
  body.innerHTML =
    '<div class="ai-head"><span class="ai-tag">AI 解析</span>' +
    '<span class="muted small">AI 生成，仅供参考</span></div>' +
    '<div class="ai-text">' +
    (mdToHtml(acc) || '<span class="muted">（模型没有返回内容）</span>') +
    '</div>';
  btn.textContent = '收起 AI 解析';
}

/** 解析展开/收起：单题按钮 + 全局按钮联动 */
function toggleAllSolutions() {
  var bodies = document.querySelectorAll('.sol-body');
  if (!bodies.length) return;
  var anyHidden = Array.prototype.some.call(bodies, function (b) {
    return b.hidden;
  });
  Array.prototype.forEach.call(bodies, function (b) {
    b.hidden = !anyHidden;
    var btn = b.parentNode.querySelector('.toggle-sol');
    if (btn) btn.textContent = b.hidden ? '查看解析' : '收起解析';
  });
  updateToggleLabel();
}

function updateToggleLabel() {
  var bodies = document.querySelectorAll('.sol-body');
  if (!bodies.length) {
    $('btnToggleSol').hidden = true;
    return;
  }
  $('btnToggleSol').hidden = !state.submitted;
  var allOpen = Array.prototype.every.call(bodies, function (b) {
    return !b.hidden;
  });
  $('btnToggleSol').textContent = allOpen ? '收起解析' : '展开解析';
}

// ---------- 事件 ----------

$('btnSubmit').onclick = doSubmit;
$('btnToggleSol').onclick = toggleAllSolutions;
$('btnQuick').onclick = startQuick;

$('btnAgain').onclick = function () {
  var kp = (state.meta && state.meta.feature && state.meta.feature.keypointId) || state.keypointId;
  var node = kp
    ? (function find(list) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === Number(kp)) return list[i];
          if (list[i].children) {
            var r = find(list[i].children);
            if (r) return r;
          }
        }
        return null;
      })(state.tree)
    : null;
  // 快速练习 / 无关联考点的练习 → 再来一组就是再来一套快速练习
  if (!node) return startQuick();
  startExercise(node);
};

Array.prototype.forEach.call(document.querySelectorAll('.tabs .tab'), function (t) {
  t.onclick = function () {
    switchView(t.dataset.view);
  };
});

$('btnTheme').onclick = cycleTheme;

$('btnSettings').onclick = function () {
  if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL('options/options.html'));
};

$('btnLogin').onclick = showLogin;

$('btnLogout').onclick = function () {
  if (!confirm('退出登录？')) return;
  chrome.storage.local.remove(['fenbiUser']);
  state.user = null;
  renderMe();
  showLogin();
};

$('modalClose').onclick = hideModal;

$('modal').onclick = function (e) {
  if (e.target === $('modal')) hideModal(); // 点遮罩关闭
};

Array.prototype.forEach.call(document.querySelectorAll('.stab'), function (b) {
  b.onclick = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.stab'), function (x) {
      x.classList.toggle('active', x === b);
    });
    var isTree = b.dataset.pane === 'tree';
    $('paneTree').hidden = !isTree;
    $('paneHist').hidden = isTree;
    if (!isTree && !state.histLoaded) loadHistory(true);
  };
});

init();
