/**
 * 粉笔（fenbi.com）API 封装
 * 与运行环境无关：Chrome 扩展、IDEA 插件、Node 脚本均可复用。
 * 依赖：fetch + 能带上 .fenbi.com 的 Cookie（登录凭证是 HttpOnly Cookie）。
 *
 * 接口来源：实机抓包 + SPA JS bundle 反查，详见 docs/fenbi-api-notes.md
 */
var FenbiAPI = (function () {
  'use strict';

  var HOST = {
    login: 'https://login.fenbi.com',
    ke: 'https://ke.fenbi.com',
    tiku: 'https://tiku.fenbi.com',
  };

  // 刷题接口通用参数（题库页实际使用的值）
  var COMMON = {
    app: 'web',
    kav: 125,
    av: 127,
    hav: 125,
    gav: 2,
    apcid: 0,
    deviceId: '',
  };

  // 官网/登录接口使用另一套版本号
  var WWW_COMMON = {
    app: 'web',
    av: 100,
    hav: 100,
    kav: 100,
    gav: 2,
    apcid: 0,
  };

  var WWW_COMMON2 = {
    app: 'web',
    kav: 131,
    av: 134,
    hav: 128,
    version: '3.0.0.0',
    deviceId: '',
    gav: 2,
    apcId: 0,
  };

  // 科目前缀 → courseId（用于拼 exerciseKey 的 32 进制段，调试/校验用）
  var COURSES = {
    syzc: { id: 110, name: '职测' },
    zhyynl: { id: 1070, name: '综应' },
    sydw: { id: 100, name: '公基' },
  };

  // ---------- 工具 ----------

  function qs(params) {
    var parts = [];
    for (var k in params) {
      if (params[k] === undefined || params[k] === null) continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return parts.join('&');
  }

  function randId(len) {
    var s = '';
    var hex = '0123456789abcdef';
    for (var i = 0; i < len; i++) s += hex[Math.floor(Math.random() * 16)];
    return s;
  }

  /**
   * 统一请求。带 Cookie，返回解析后的 JSON（解析失败返回原始文本）。
   */
  function request(url, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: options.headers || {},
    };
    if (options.body !== undefined) init.body = options.body;
    return fetch(url, init).then(function (res) {
      if (options.raw) return res;
      return res.text().then(function (text) {
        try {
          return JSON.parse(text);
        } catch (e) {
          return { __raw: text, __status: res.status };
        }
      });
    });
  }

  function formEncode(obj) {
    return qs(obj);
  }

  // ---------- 登录 ----------

  /** 生成登录二维码：返回 {lgtoken, codeContent} */
  function genLoginQR() {
    var url =
      HOST.ke +
      '/qrcode-login/api/gen_code?' +
      qs(Object.assign({ random: Math.random(), client_context_id: randId(32) }, WWW_COMMON));
    return request(url).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '二维码生成失败');
      return res.data;
    });
  }

  /**
   * 轮询扫码状态
   * @returns Promise<{code, msg, data}>  data: 1=待扫码 2=已扫码待确认 3=已登录
   */
  function queryLoginStatus(lgtoken) {
    var url =
      HOST.ke +
      '/qrcode-login/api/query_code_status?' +
      qs(Object.assign({ deviceId: '', client_context_id: randId(32) }, WWW_COMMON));
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lgtoken: lgtoken }),
    });
  }

  /** 登录态检查：未登录返回 401（此处表现为 res.code 缺失或 __status=401） */
  function getUserCurrent() {
    var url = HOST.login + '/api/users/current?' + qs(WWW_COMMON2);
    return request(url, { raw: true }).then(function (res) {
      if (res.status === 401) return null;
      return res.json().catch(function () {
        return null;
      });
    });
  }

  function getUserInfo() {
    var url = HOST.login + '/api/users/info?' + qs(WWW_COMMON2);
    return request(url).then(function (r) {
      return r && r.userId ? r : null;
    });
  }

  // ---------- 题库：分类 ----------

  /** 当前考试类目（含 prefix / examCategoryId） */
  function getExamCategory() {
    var url =
      HOST.tiku +
      '/activity/userexamcategory/getCurrent?' +
      qs(Object.assign({ noCacheTag: Date.now() }, WWW_COMMON2));
    return request(url).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '获取考试类目失败');
      return res.data;
    });
  }

  /** 考点树（三级） */
  function getKeypointTree(prefix, examCategoryId) {
    var url =
      HOST.tiku +
      '/api/' +
      prefix +
      '/categories/home?filter=keypoint&' +
      qs(Object.assign({ examcatid: examCategoryId }, WWW_COMMON2));
    return request(url).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '获取考点树失败');
      return res.data.baseKeypointVOS || [];
    });
  }

  // ---------- 练习 ----------

  /**
   * 创建练习
   * @param {string} prefix  syzc / zhyynl / sydw
   * @param {number|null} keypointId 考点 id；
   *        **传 null/undefined = 快速智能练习**（不限考点，全科目混合，固定 15 题，
   *        服务端返回 sheet.name = "快速智能练习"、sheet.keypointId = 0）
   * @param {number} type  3=智能练习(15题) 2=全真模拟(整卷) 1=真题(需 paperId)
   * 注：count 参数实测无效，服务端恒返回 15 题。
   */
  function createExercise(prefix, keypointId, type, extra) {
    type = type || 3;
    var body = Object.assign({ type: type, exerciseTimeMode: 1 }, extra || {});
    if (keypointId) body.keypointId = keypointId;
    var url = HOST.tiku + '/api/' + prefix + '/exercises?' + qs(Object.assign({ routecs: prefix }, COMMON));
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode(body),
    }).then(function (res) {
      if (!res || !res.key) throw new Error((res && res.msg) || '创建练习失败');
      return res;
    });
  }

  /** 练习元信息（含 requestKey、提交/交卷 URL、已答内容） */
  function getExercise(prefix, key) {
    var url =
      HOST.tiku +
      '/combine/exercise/getExercise?format=html&' +
      qs(Object.assign({ key: key, routecs: prefix }, COMMON));
    return request(url).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '获取练习失败');
      return res.data;
    });
  }

  /** 题目内容（题干 + 选项，无答案）。url 传 getExercise 返回的 staticUrl.urls[0] */
  function getQuestionsByUrl(url) {
    return request(url).then(function (res) {
      if (!res || !res.questions) throw new Error('获取题目失败');
      return res;
    });
  }

  /** 题目内容：直接用 requestKey 拼 */
  function getQuestions(prefix, requestKey, examCategoryId) {
    var url =
      HOST.tiku +
      '/combine/static/exercise?' +
      qs(Object.assign({ key: requestKey, routecs: prefix, type: 1, examcatid: examCategoryId }, COMMON));
    return getQuestionsByUrl(url);
  }

  /**
   * 提交答案（可批量）
   * @param {Array} answers [{key:globalId, id, prefix, answer:{choice:'0',type:201}, time:秒}]
   */
  function submitAnswers(prefix, exerciseKey, answers) {
    var url =
      HOST.tiku + '/combine/exercise/incrUpdate?' + qs(Object.assign({ key: exerciseKey, routecs: prefix }, COMMON));
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answers),
    }).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '提交答案失败');
      return true;
    });
  }

  /** 交卷 */
  function submitExercise(prefix, exerciseKey, examCategoryId) {
    var url =
      HOST.tiku +
      '/combine/exercise/submit?' +
      qs(Object.assign({ key: exerciseKey, routecs: prefix, examcatid: examCategoryId }, COMMON));
    return request(url, { method: 'POST' }).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '交卷失败');
      return true;
    });
  }

  // ---------- 解析 ----------

  function getSolution(prefix, exerciseKey) {
    var url =
      HOST.tiku +
      '/combine/exercise/getSolution?format=html&' +
      qs(Object.assign({ key: exerciseKey, routecs: prefix }, COMMON));
    return request(url).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '获取解析失败');
      return res.data;
    });
  }

  /** 解析内容（答案 + 解析 HTML + 考点 + 来源） */
  function getSolutionContent(prefix, requestKey, examCategoryId) {
    var url =
      HOST.tiku +
      '/combine/static/solution?' +
      qs(Object.assign({ key: requestKey, routecs: prefix, type: 1, examcatid: examCategoryId }, COMMON));
    return request(url).then(function (res) {
      if (!res || !res.solutions) throw new Error('获取解析内容失败');
      return res;
    });
  }

  /** 每题全站正确率 / 易错项 */
  function getQuestionMeta(prefix, requestKey) {
    var url =
      HOST.tiku + '/combine/question/getMeta?' + qs(Object.assign({ requestKey: requestKey, routecs: prefix }, COMMON));
    return request(url).then(function (res) {
      return res && res.code === 1 ? res.data : {};
    });
  }

  /** 练习报告 */
  function getReport(prefix, exerciseKey) {
    var url =
      HOST.tiku +
      '/combine/exercise/getReport?format=html&' +
      qs(Object.assign({ key: exerciseKey, routecs: prefix, no_toast: '' }, COMMON));
    return request(url).then(function (res) {
      return res && res.code === 1 ? res.data : null;
    });
  }

  // ---------- 其他 ----------

  // ---------- 历史记录 ----------

  /**
   * 历史练习列表（cursor 分页）
   * @returns {historyItems:[{exerciseKey,sheetName,sheetType,status,questionCount,correctCount,updatedTime,...}], cursor}
   *          status: 0=未交卷(可继续做) 1=已交卷 3=其他
   */
  function getHistory(prefix, limit, cursor) {
    var url =
      HOST.tiku +
      '/combine/exercise/getExerciseBriefHistory?' +
      qs(
        Object.assign(
          {
            noCacheTag: Date.now(),
            categoryId: 4,
            limit: limit || 20,
            cursor: cursor || '',
            routecs: prefix,
          },
          COMMON
        )
      );
    return request(url).then(function (res) {
      if (!res || res.code !== 1) throw new Error((res && res.msg) || '获取历史记录失败');
      return { items: res.data.historyItems || [], cursor: res.data.cursor };
    });
  }

  /** 未完成的练习（可续做） */
  function getUnfinished(prefix, examCategoryId) {
    var url =
      HOST.tiku +
      '/api/' +
      prefix +
      '/category-exercises-unfinished?' +
      qs(Object.assign({ noCacheTag: Date.now(), examcatid: examCategoryId }, WWW_COMMON2));
    return request(url).then(function (res) {
      return res && res.combineKey ? res : null;
    });
  }

  /** 错题/收藏/笔记统计 */
  function getCollectNoteError(prefix, examCategoryId) {
    var url =
      HOST.tiku +
      '/api/' +
      prefix +
      '/userCollectNoteError?type=u_error,u_note,u_collect&' +
      qs(Object.assign({ examcatid: examCategoryId }, WWW_COMMON2));
    return request(url).then(function (res) {
      return res && res.code === 1 ? res.data : null;
    });
  }

  return {
    HOST: HOST,
    COURSES: COURSES,
    genLoginQR: genLoginQR,
    queryLoginStatus: queryLoginStatus,
    getUserCurrent: getUserCurrent,
    getUserInfo: getUserInfo,
    getExamCategory: getExamCategory,
    getKeypointTree: getKeypointTree,
    createExercise: createExercise,
    getExercise: getExercise,
    getQuestions: getQuestions,
    getQuestionsByUrl: getQuestionsByUrl,
    submitAnswers: submitAnswers,
    submitExercise: submitExercise,
    getSolution: getSolution,
    getSolutionContent: getSolutionContent,
    getQuestionMeta: getQuestionMeta,
    getReport: getReport,
    getHistory: getHistory,
    getUnfinished: getUnfinished,
    getCollectNoteError: getCollectNoteError,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FenbiAPI;
