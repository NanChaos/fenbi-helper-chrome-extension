/**
 * AI 解析能力层
 * 1) 平台预设（DeepSeek / OpenAI / 通义 / GLM / Kimi / 豆包 / 硅基流动 / Ollama / 自定义）
 * 2) OpenAI 兼容的 /chat/completions 流式调用 + /models 拉取
 * 3) 外观设置（主题模式 + 主题色）的应用
 *
 * 被 panel/panel.js 与 options/options.js 共用。
 */
var FenbiAI = (function () {
  'use strict';

  var DEFAULT_ACCENT = '#f2632a';

  /** 预设主题色 */
  var ACCENTS = [
    { name: '粉笔橙', value: '#f2632a' },
    { name: '朱砂红', value: '#e5484d' },
    { name: '樱花粉', value: '#e93d82' },
    { name: '葡萄紫', value: '#8e4ec6' },
    { name: '靛蓝', value: '#3e63dd' },
    { name: '天青', value: '#0090ff' },
    { name: '青碧', value: '#12a594' },
    { name: '森绿', value: '#30a46c' },
    { name: '石墨', value: '#5b6472' },
  ];

  /**
   * 平台预设。
   * baseUrl 一律填到「含版本号的完整前缀」，调用时再拼 /chat/completions、/models。
   */
  var PROVIDERS = [
    {
      key: 'deepseek',
      name: 'DeepSeek（深度求索）',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      keyHint: 'sk-...',
      doc: 'https://platform.deepseek.com',
    },
    {
      key: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
      keyHint: 'sk-...',
      doc: 'https://platform.openai.com',
    },
    {
      key: 'qwen',
      name: '通义千问（阿里云百炼）',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
      keyHint: 'sk-...',
      doc: 'https://bailian.console.aliyun.com',
    },
    {
      key: 'glm',
      name: '智谱 GLM（清言）',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus', 'glm-4.5'],
      keyHint: 'xxx.yyy（id.secret）',
      doc: 'https://open.bigmodel.cn',
    },
    {
      key: 'moonshot',
      name: 'Moonshot（Kimi）',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      keyHint: 'sk-...',
      doc: 'https://platform.moonshot.cn',
    },
    {
      key: 'volc',
      name: '豆包（火山方舟）',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      models: [],
      modelHint: '填「接入点 ID」，形如 ep-2024xxxx-xxxxx',
      keyHint: 'ARK_API_KEY',
      doc: 'https://console.volcengine.com/ark',
    },
    {
      key: 'siliconflow',
      name: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-32B-Instruct', 'deepseek-ai/DeepSeek-V3'],
      keyHint: 'sk-...',
      doc: 'https://cloud.siliconflow.cn',
    },
    {
      key: 'ollama',
      name: 'Ollama（本地）',
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen2.5', 'llama3.2', 'gemma2'],
      optionalKey: true,
      keyHint: '本地可不填',
      doc: 'https://ollama.com',
    },
    {
      key: 'custom',
      name: '自定义（OpenAI 兼容）',
      baseUrl: '',
      models: [],
      custom: true,
      keyHint: '按你的服务填写',
    },
  ];

  var DEFAULT_PROMPT = [
    '你是资深的事业单位考试辅导老师，精通《职业能力倾向测验》《综合应用能力》《公共基础知识》。',
    '请对给定题目做深度解析，严格按以下结构输出：',
    '',
    '**一、结论**',
    '一句话给出正确选项和核心依据。',
    '',
    '**二、逐项分析**',
    '逐个选项说明对或错的原因。',
    '',
    '**三、解题技巧**',
    '本题的切入角度、可复用的解题方法或秒杀技巧。',
    '',
    '**四、知识拓展**',
    '关联考点、易混淆点与记忆口诀。',
    '',
    '要求：中文；控制在 800 字以内；不要复述题目原文；不要写客套话。',
  ].join('\n');

  // ---------------- 设置 ----------------

  function defaultSettings() {
    var p = PROVIDERS[0];
    return {
      appearance: {
        theme: '', // ''=跟随系统 light dark
        accent: DEFAULT_ACCENT,
      },
      ai: {
        provider: p.key,
        baseUrl: p.baseUrl,
        apiKey: '',
        model: p.models[0] || '',
        temperature: 0.3,
        maxTokens: 1200,
        timeoutSec: 90,
        useOfficial: true,
        extraHeaders: '',
        systemPrompt: DEFAULT_PROMPT,
      },
    };
  }

  /** 深合并，保证旧版本存的缺失字段有值；平台若非默认，则按该平台的预设兜底 */
  function mergeSettings(saved) {
    var def = defaultSettings();
    if (!saved) return def;
    var s = saved.ai || {};
    var p = providerOf(s.provider || def.ai.provider);
    var presetBase = (p && p.baseUrl) || '';
    var presetModel = (p && p.models && p.models[0]) || '';
    return {
      appearance: {
        theme: (saved.appearance && saved.appearance.theme) || def.appearance.theme,
        accent: (saved.appearance && saved.appearance.accent) || def.appearance.accent,
      },
      ai: {
        provider: s.provider || def.ai.provider,
        baseUrl: s.baseUrl != null && s.baseUrl !== '' ? s.baseUrl : presetBase,
        apiKey: s.apiKey || def.ai.apiKey,
        model: s.model || presetModel,
        temperature: numOr(s.temperature, def.ai.temperature),
        maxTokens: numOr(s.maxTokens, def.ai.maxTokens),
        timeoutSec: numOr(s.timeoutSec, def.ai.timeoutSec),
        useOfficial: typeof s.useOfficial === 'boolean' ? s.useOfficial : def.ai.useOfficial,
        extraHeaders: s.extraHeaders || def.ai.extraHeaders,
        systemPrompt: s.systemPrompt || def.ai.systemPrompt,
      },
    };
  }

  function numOr(v, d) {
    var n = Number(v);
    return isFinite(n) && v !== '' && v !== null && v !== undefined ? n : d;
  }

  function providerOf(key) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].key === key) return PROVIDERS[i];
    }
    return null;
  }

  function normalizeBaseUrl(u) {
    return String(u || '').replace(/\/+$/, '');
  }

  // ---------------- 主机权限 ----------------
  // MV3 下扩展页（侧边栏 / 选项页）发起的跨域 fetch 需要目标 host 权限。
  // 预设平台的域名放进 optional_host_permissions，用户配置时才弹一次授权，
  // 避免安装时对所有人都显示一堆「读取你在 xx 上的数据」警告。

  /** baseUrl → origin 匹配模式，如 https://api.deepseek.com/* */
  function originPattern(baseUrl) {
    try {
      var u = new URL(baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.origin + '/*';
    } catch (e) {
      return null;
    }
  }

  function hasPermission(origin) {
    return new Promise(function (resolve) {
      if (!chrome.permissions || !chrome.permissions.contains) return resolve(true);
      chrome.permissions.contains({ origins: [origin] }, function (has) {
        resolve(!!has);
      });
    });
  }

  function requestOrigin(origin) {
    return new Promise(function (resolve) {
      try {
        chrome.permissions.request({ origins: [origin] }, function (granted) {
          var err = chrome.runtime && chrome.runtime.lastError;
          resolve({ ok: !!granted && !err, origin: origin, reason: err ? err.message : '' });
        });
      } catch (e) {
        resolve({ ok: false, origin: origin, reason: (e && e.message) || String(e) });
      }
    });
  }

  /**
   * 确保已有目标 host 权限（没有就申请一次，需在用户手势里调用）。
   * 自定义域名不在可选权限清单里时，兜底申请通配 host 权限。
   * @returns {Promise<{ok:boolean, origin:string|null, reason:string}>}
   */
  function ensurePermission(baseUrl) {
    var origin = originPattern(baseUrl);
    if (!origin) return Promise.resolve({ ok: true, origin: null, reason: '' });
    if (!chrome.permissions || !chrome.permissions.request) {
      return Promise.resolve({ ok: true, origin: origin, reason: '' });
    }
    return hasPermission(origin)
      .then(function (has) {
        return has ? { ok: true, origin: origin, reason: '' } : requestOrigin(origin);
      })
      .then(function (r) {
        if (r.ok) return r;
        return requestOrigin('*://*/*').then(function (r2) {
          return r2.ok ? { ok: true, origin: origin, reason: '' } : r;
        });
      });
  }

  // ---------------- 外观 ----------------

  function parseHex(hex) {
    var s = String(hex || '').trim().replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  /** 主题色上应该配黑字还是白字 */
  function textOn(hex) {
    var c = parseHex(hex);
    if (!c) return '#ffffff';
    var ch = [c[0] / 255, c[1] / 255, c[2] / 255].map(function (v) {
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    return L > 0.42 ? '#1f2328' : '#ffffff';
  }

  /** 把外观设置落到页面（主题模式 + 主题色） */
  function applyAppearance(settings) {
    var root = document.documentElement;
    var ap = settings.appearance || {};
    if (ap.theme) root.setAttribute('data-theme', ap.theme);
    else root.removeAttribute('data-theme');
    var accent = ap.accent || DEFAULT_ACCENT;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', textOn(accent));
  }

  // ---------------- AI 调用 ----------------

  function buildHeaders(cfg) {
    var h = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) h['Authorization'] = 'Bearer ' + cfg.apiKey;
    if (cfg.extraHeaders) {
      try {
        var extra = JSON.parse(cfg.extraHeaders);
        for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
      } catch (e) {
        /* 忽略非法 JSON */
      }
    }
    return h;
  }

  function apiError(res, text) {
    var msg = 'HTTP ' + res.status;
    try {
      var j = JSON.parse(text);
      msg += ' ' + ((j.error && (j.error.message || j.error.code)) || j.message || j.msg || '');
    } catch (e) {
      msg += ' ' + String(text || '').slice(0, 160);
    }
    return new Error(msg.trim());
  }

  /**
   * 流式对话
   * @param {object} cfg  ai 设置段
   * @param {Array} messages
   * @param {function} onDelta 收到增量文本
   * @param {AbortSignal} [signal]
   */
  function chatStream(cfg, messages, onDelta, signal) {
    var base = normalizeBaseUrl(cfg.baseUrl);
    if (!base) return Promise.reject(new Error('未配置 API 地址'));
    if (!cfg.model) return Promise.reject(new Error('未配置模型'));

    var body = {
      model: cfg.model,
      messages: messages,
      temperature: numOr(cfg.temperature, 0.3),
      max_tokens: numOr(cfg.maxTokens, 1200),
      stream: true,
    };

    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify(body),
      signal: signal,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw apiError(res, t);
        });
      }
      if (!res.body) return nonStreamFallback(res, onDelta);

      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '';

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += decoder.decode(r.value || new Uint8Array(), { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop(); // 最后一段可能不完整，留到下一轮
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              var j = JSON.parse(data);
              var ch0 = j.choices && j.choices[0];
              var delta = ch0 && (ch0.delta || ch0.message) || {};
              if (delta.content) onDelta(delta.content);
              else if (typeof ch0 === 'object' && ch0.text) onDelta(ch0.text);
            } catch (e) {
              /* 忽略无法解析的片段 */
            }
          }
          return pump();
        });
      }

      return pump();
    });
  }

  /** 服务端不支持流时的兜底 */
  function nonStreamFallback(res, onDelta) {
    return res.text().then(function (t) {
      try {
        var j = JSON.parse(t);
        var ch0 = j.choices && j.choices[0];
        var txt = (ch0 && ((ch0.message && ch0.message.content) || ch0.text)) || '';
        onDelta(txt);
      } catch (e) {
        onDelta(t);
      }
    });
  }

  /** 拉取模型列表：GET {baseUrl}/models */
  function listModels(cfg) {
    var base = normalizeBaseUrl(cfg.baseUrl);
    if (!base) return Promise.reject(new Error('未配置 API 地址'));
    return fetch(base + '/models', { method: 'GET', headers: buildHeaders(cfg) }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw apiError(res, t);
        });
      }
      return res.text().then(function (t) {
        var j;
        try {
          j = JSON.parse(t);
        } catch (e) {
          throw new Error('返回不是 JSON');
        }
        var arr = (j && j.data) || j || [];
        return arr
          .map(function (m) {
            return (m && (m.id || m.name || m.model)) || '';
          })
          .filter(Boolean);
      });
    });
  }

  /** 连通性测试：用一个极短的请求验证 key / 地址 / 模型 */
  function testConnection(cfg) {
    var base = normalizeBaseUrl(cfg.baseUrl);
    if (!base) return Promise.reject(new Error('未配置 API 地址'));
    if (!cfg.model) return Promise.reject(new Error('未配置模型'));
    var body = {
      model: cfg.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      stream: false,
    };
    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw apiError(res, t);
        });
      }
      return res.text().then(function (t) {
        var txt = t;
        try {
          var j = JSON.parse(t);
          var ch0 = j.choices && j.choices[0];
          txt = (ch0 && ((ch0.message && ch0.message.content) || ch0.text)) || JSON.stringify(j).slice(0, 80);
        } catch (e) {
          /* 保留原文 */
        }
        return String(txt).trim().slice(0, 60);
      });
    });
  }

  return {
    DEFAULT_ACCENT: DEFAULT_ACCENT,
    DEFAULT_PROMPT: DEFAULT_PROMPT,
    ACCENTS: ACCENTS,
    PROVIDERS: PROVIDERS,
    defaultSettings: defaultSettings,
    mergeSettings: mergeSettings,
    providerOf: providerOf,
    normalizeBaseUrl: normalizeBaseUrl,
    originPattern: originPattern,
    ensurePermission: ensurePermission,
    applyAppearance: applyAppearance,
    textOn: textOn,
    chatStream: chatStream,
    listModels: listModels,
    testConnection: testConnection,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FenbiAI;
