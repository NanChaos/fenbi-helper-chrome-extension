/**
 * 选项页（chrome://extensions → 粉笔刷题助手 → 扩展程序选项）
 * 两类设置：外观（主题模式 / 主题色）、AI（平台 / 地址 / Key / 模型 / 生成参数 / 提示词）
 * 保存后写进 chrome.storage.local.fenbiSettings，侧边栏通过 storage.onChanged 实时生效。
 */
(function () {
  'use strict';

  var $ = function (id) {
    return document.getElementById(id);
  };

  var settings = FenbiAI.defaultSettings();

  // ---------------- 载入 / 落盘 ----------------

  function load(cb) {
    chrome.storage.local.get(['fenbiSettings', 'fenbiTheme'], function (r) {
      settings = FenbiAI.mergeSettings(r.fenbiSettings);
      // 兼容 0.6.x：主题当时存在单独的 fenbiTheme 键
      if (!r.fenbiSettings && r.fenbiTheme) settings.appearance.theme = r.fenbiTheme;
      if (cb) cb();
    });
  }

  function save(silent) {
    chrome.storage.local.set({ fenbiSettings: settings }, function () {
      FenbiAI.applyAppearance(settings);
      if (!silent) {
        var tip = $('saveTip');
        tip.textContent = '已保存';
        tip.className = 'small ok-text';
        setTimeout(function () {
          tip.textContent = '';
        }, 2000);
      }
    });
  }

  // ---------------- 外观 ----------------

  function renderAppearance() {
    var ap = settings.appearance;

    Array.prototype.forEach.call($('themeSeg').children, function (b) {
      b.classList.toggle('active', b.dataset.theme === (ap.theme || ''));
    });

    var wrap = $('swatches');
    wrap.innerHTML = '';
    FenbiAI.ACCENTS.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw' + (a.value.toLowerCase() === String(ap.accent).toLowerCase() ? ' active' : '');
      b.style.background = a.value;
      b.title = a.name + ' ' + a.value;
      b.onclick = function () {
        setAccent(a.value);
      };
      wrap.appendChild(b);
    });

    $('accentPicker').value = normalizeHex(ap.accent);
    $('accentHex').value = ap.accent;
  }

  function normalizeHex(v) {
    var s = String(v || '').trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(s)) return FenbiAI.DEFAULT_ACCENT;
    return s.charAt(0) === '#' ? s : '#' + s;
  }

  function setAccent(v) {
    settings.appearance.accent = v;
    renderAppearance();
    FenbiAI.applyAppearance(settings); // 实时预览
  }

  // ---------------- AI ----------------

  function renderProviders() {
    var sel = $('aiProvider');
    sel.innerHTML = '';
    FenbiAI.PROVIDERS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.key;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.value = settings.ai.provider;
  }

  function syncProviderUI() {
    var p = FenbiAI.providerOf(settings.ai.provider);
    var custom = !p || p.custom;

    $('aiDoc').hidden = !p || !p.doc;
    if (p && p.doc) $('aiDoc').href = p.doc;

    $('aiBase').readOnly = false; // 允许在预设基础上改（走代理时很常见）
    $('aiBase').placeholder = custom ? 'https://your-gateway.com/v1' : p.baseUrl;

    $('baseHint').textContent = custom
      ? 'OpenAI 兼容协议。填到含版本号的完整前缀，程序会拼接 /chat/completions 与 /models。'
      : '已按「' + p.name + '」填入预设地址；如需走自建代理可直接改。';

    $('aiKey').placeholder = p ? p.keyHint || 'sk-...' : 'sk-...';

    var hint = p && p.modelHint ? p.modelHint : '';
    if (p && p.optionalKey) hint = hint || '本地服务，API Key 可留空';
    $('modelHint').textContent = hint;

    fillModelList(p ? p.models || [] : []);
  }

  function fillModelList(models) {
    var dl = $('aiModelList');
    dl.innerHTML = '';
    models.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m;
      dl.appendChild(o);
    });
  }

  function renderAI() {
    var ai = settings.ai;
    $('aiBase').value = ai.baseUrl || '';
    $('aiKey').value = ai.apiKey || '';
    $('aiModel').value = ai.model || '';
    $('aiTemp').value = ai.temperature;
    $('aiTempVal').textContent = Number(ai.temperature).toFixed(1);
    $('aiMaxTok').value = ai.maxTokens;
    $('aiTimeout').value = ai.timeoutSec;
    $('aiUseOfficial').checked = !!ai.useOfficial;
    $('aiHeaders').value = ai.extraHeaders || '';
    $('aiPrompt').value = ai.systemPrompt || '';
  }

  function collectAI() {
    var ai = settings.ai;
    ai.baseUrl = $('aiBase').value.trim();
    ai.apiKey = $('aiKey').value.trim();
    ai.model = $('aiModel').value.trim();
    ai.temperature = Number($('aiTemp').value);
    ai.maxTokens = Number($('aiMaxTok').value) || 1200;
    ai.timeoutSec = Number($('aiTimeout').value) || 90;
    ai.useOfficial = $('aiUseOfficial').checked;
    ai.extraHeaders = $('aiHeaders').value.trim();
    ai.systemPrompt = $('aiPrompt').value;
  }

  /**
   * MV3：扩展页跨域请求需要目标 host 权限。
   * 预设域名走可选权限（用到才弹一次），自定义域名兜底申请通配 host 权限。
   */
  function withPermission(then) {
    var res = $('testResult');
    FenbiAI.ensurePermission(settings.ai.baseUrl).then(function (r) {
      if (!r.ok) {
        res.className = 'small err-text';
        res.textContent =
          '未获得访问 ' + (r.origin || settings.ai.baseUrl) + ' 的权限' + (r.reason ? '：' + r.reason : '');
        return;
      }
      then();
    });
  }

  // ---------------- 事件 ----------------

  Array.prototype.forEach.call($('themeSeg').children, function (b) {
    b.onclick = function () {
      settings.appearance.theme = b.dataset.theme;
      renderAppearance();
      FenbiAI.applyAppearance(settings);
    };
  });

  $('accentPicker').oninput = function () {
    setAccent(this.value);
  };

  $('accentHex').onchange = function () {
    var v = this.value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(v)) {
      this.value = settings.appearance.accent;
      return;
    }
    setAccent(v.charAt(0) === '#' ? v.toLowerCase() : '#' + v.toLowerCase());
  };

  $('accentReset').onclick = function () {
    setAccent(FenbiAI.DEFAULT_ACCENT);
  };

  $('aiProvider').onchange = function () {
    settings.ai.provider = this.value;
    var p = FenbiAI.providerOf(this.value);
    if (p && !p.custom) {
      settings.ai.baseUrl = p.baseUrl;
      if (p.models && p.models.length) {
        if (!p.models.some(function (m) { return m === settings.ai.model; })) {
          settings.ai.model = p.models[0];
        }
      } else {
        settings.ai.model = '';
      }
    }
    syncProviderUI();
    renderAI();
  };

  $('btnToggleKey').onclick = function () {
    var el = $('aiKey');
    var show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    this.textContent = show ? '隐藏' : '显示';
  };

  $('aiTemp').oninput = function () {
    $('aiTempVal').textContent = Number(this.value).toFixed(1);
  };

  $('btnModels').onclick = function () {
    collectAI();
    var btn = this;
    var res = $('testResult');
    btn.disabled = true;
    res.className = 'small muted';
    res.textContent = '拉取中…';
    withPermission(function () {
    FenbiAI.listModels(settings.ai)
      .then(function (list) {
        fillModelList(list);
        res.className = 'small ok-text';
        res.textContent = '共 ' + list.length + ' 个模型' + (list.length ? '，可在下拉里选' : '');
      })
      .catch(function (e) {
        res.className = 'small err-text';
        res.textContent = '拉取失败：' + (e.message || e);
      })
      .then(function () {
        btn.disabled = false;
      });
    });
  };

  $('btnPromptReset').onclick = function () {
    $('aiPrompt').value = FenbiAI.DEFAULT_PROMPT;
  };

  $('btnTest').onclick = function () {
    collectAI();
    var btn = this;
    var res = $('testResult');
    btn.disabled = true;
    res.className = 'small muted';
    res.textContent = '测试中…';
    withPermission(function () {
    FenbiAI.testConnection(settings.ai)
      .then(function (txt) {
        res.className = 'small ok-text';
        res.textContent = '连接成功' + (txt ? '：' + txt : '');
      })
      .catch(function (e) {
        res.className = 'small err-text';
        res.textContent = '失败：' + (e.message || e);
      })
      .then(function () {
        btn.disabled = false;
      });
    });
  };

  $('btnSave').onclick = function () {
    collectAI();
    // 保存时顺手把权限申请掉，这样侧边栏首次点「AI 解析」不用再弹一次
    FenbiAI.ensurePermission(settings.ai.baseUrl).then(function () {
      save(false);
    });
  };

  $('btnReset').onclick = function () {
    if (!confirm('恢复所有设置为默认值？（AI Key 会清空）')) return;
    settings = FenbiAI.defaultSettings();
    renderAppearance();
    renderProviders();
    syncProviderUI();
    renderAI();
    FenbiAI.applyAppearance(settings);
    save(false);
  };

  // ---------------- 启动 ----------------

  load(function () {
    renderAppearance();
    renderProviders();
    syncProviderUI();
    renderAI();
    FenbiAI.applyAppearance(settings);
  });
})();
