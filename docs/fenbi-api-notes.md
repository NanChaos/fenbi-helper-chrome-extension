# 粉笔（fenbi.com）Web 端接口逆向文档

> 用途：为 **Chrome 插件 / IDEA 插件** 复刻粉笔刷题能力（扫码登录 → 选题 → 刷题 → 提交 → 看解析 → 题目图片）提供接口依据。
> 来源：Chrome 实机抓包 + 前端 JS bundle 反查（`main.b9a1abbe2b3211e5.js`），接口均为官方网页端在用接口。
> 抓取账号：安徽·事业单位·职测（course prefix `syzc`，courseId `110`，examCategoryId `1000009`）

---

## 0. 通用约定

### 0.1 域名

| 域名 | 用途 |
|---|---|
| `ke.fenbi.com` | 扫码登录、课程、会员 |
| `login.fenbi.com` | 账号/登录态/图片域名配置 |
| `tiku.fenbi.com` | **题库主域**（分类、练习、提交、解析） |
| `spa.fenbi.com` | 刷题 SPA 页面（`/ti/exam/exercise/{key}`） |
| `fb.fbstatic.cn` / `fb.fenbike.cn` | 题目图片 CDN（**无需鉴权**） |
| `urlimg.fenbi.com` | PDF 导出 |

前端有代理前缀 `/tikuApi/{prefix}/xxx`，等价于 `https://tiku.fenbi.com/api/{prefix}/xxx`。
`{prefix}` 为科目前缀：**`syzc`=职测，`zhyynl`=综应，`sydw`=公基**。

### 0.2 通用 Query 参数（每个接口都带）

| 参数 | 值 | 说明 |
|---|---|---|
| `app` | `web` | 固定 |
| `kav` | `125` / `131` | API 版本（不同页面略有差异，实测两者都接受） |
| `av` | `127` / `134` | 同上 |
| `hav` | `125` / `128` | 同上 |
| `gav` | `2` | 固定 |
| `apcid` / `apcId` | `0` | 固定 |
| `deviceId` | 空或 `v1_xxx` | 官网用 localStorage 的 `DEVICE_SID`；题库页传空即可 |
| `routecs` | `syzc` | 科目前缀，**刷题接口必带** |
| `examcatid` | `1000009` | 考试类目（安徽单招），部分接口需要 |

> ⚠️ 所有请求必须 **携带 Cookie**（`credentials: 'include'`）；登录凭证是 **HttpOnly Cookie**（JS 读不到，插件需走 Chrome cookies API 或让浏览器自动携带）。

### 0.3 响应包裹

```json
{"code": 1, "data": {...}, "msg": "SUCCESS"}
```
`code=1` 成功；`code=-11` 等业务错误看 `msg`。

---

## 1. 登录：扫码登录 ✅（完整验证）

### 1.0 ⭐ 前置：获取 device_id（非浏览器客户端必做）

**没有浏览器帮你存 Cookie 的客户端（IDEA 插件 / 脚本 / 服务端）必须先做这一步**，
否则 `gen_code` 一律返回 `{"message":"无效DeviceSid"}`（HTTP **453**）。

```http
POST https://login.fenbi.com/api/users/device/sid/create
Content-Type: application/json

{"pf":"web","startupId":"<任意字符串>","extras":{"screen":"1920x1080x24","language":"zh-CN","platform":"Win32"}}
```

```json
{"code":1,"data":{"deviceId":"v1_381i0kdked2a8_b1e3"},"msg":"SUCCESS"}
```

同时下发 Cookie（**这才是关键，必须存进 Cookie 管理器**）：
```
Set-Cookie: device_id=v1_381i0kdked2a8_b1e3; Max-Age=630720000; Path=/; Domain=fenbi.com; HTTPOnly
```

| 项 | 说明 |
|---|---|
| 有效期 | **20 年**，可长期持久化，不必每次启动都重建 |
| 域 | `.fenbi.com` → `ke/tiku/www/login.fenbi.com` 全都会自动带上 |
| `extras` | 设备指纹（canvas / webgl / 屏幕 / 语言 / 平台）。**实测留空或只给几个字段也能成功**，服务端不强校验 |
| `startupId` | 客户端自生成的启动 id，任意字符串即可 |

**前端对应逻辑**（`main.b9a1abbe2b3211e5.js`）：HTTP 拦截器捕获到 `453` 且不是创建请求时，
调 `genDeviceSid()` → `localStorage.setItem('deviceSid', deviceId)` → 重试原请求。
401 之外的 **453 必须当作「先建 device_id 再重试」处理**。

✅ 已用 curl 验证：先建 device_id → 带 Cookie 调 `gen_code` 成功拿到 `lgtoken`；
不带则 `{"message":"无效DeviceSid"}`。

### 1.1 生成二维码

```http
GET https://ke.fenbi.com/qrcode-login/api/gen_code?random=0.549987197166227&deviceId=v1_xxx&app=web&av=100&hav=100&kav=100&gav=2&apcid=0&client_context_id=<32位hex>
```

响应：
```json
{
  "code": 1, "msg": "",
  "data": {
    "lgtoken": "360ee01b-9d3b-427f-a0b1-4908ed1309ab",
    "codeContent": "https://www.fenbi.com/depot/fenbi-scan-login/index.html?lgtoken=360ee01b-9d3b-427f-a0b1-4908ed1309ab&app=web"
  }
}
```
- `random`：0~1 随机数，防缓存
- **二维码内容 = `codeContent`**，前端用 qrcode 库本地渲染成 canvas（270×270）
- 有效期约 2~3 分钟，过期自动重新 gen_code

### 1.2 轮询扫码状态

```http
POST https://ke.fenbi.com/qrcode-login/api/query_code_status?deviceId=...&app=web&...
Content-Type: application/json

{"lgtoken":"360ee01b-9d3b-427f-a0b1-4908ed1309ab"}
```

轮询间隔 **2~3 秒**。响应状态机（实测）：

| `data` | `msg` | 含义 | 插件动作 |
|---|---|---|---|
| `1` | 创建新二维码 | 待扫码 / token 失效 | 继续轮询；若持续 1 需刷新二维码 |
| `2` | （推断）已扫码待确认 | App 端待确认 | 继续轮询 |
| `3` | **用户已登录** | 成功，Cookie 已下发 | 停止轮询 → 调 `/api/users/current` 拿用户 |

```json
{"code":1,"msg":"用户已登录","data":3}
```

### 1.3 登录态 / 用户信息

```http
GET https://login.fenbi.com/api/users/current?app=web&kav=131&av=134&hav=128&version=3.0.0.0&deviceId=&gav=2&apcId=0
GET https://login.fenbi.com/api/users/info?...
```

未登录 → `401`。登录后：
```json
// users/current
{"id":159027775,"email":null,"phone":"18226624738","createdTime":1757900029455,"identity":"18226624738","hasLayOff":false}

// users/info
{"userId":159027775,"nickname":"用户0aLgo7","userType":0,"phone":"18226624738","avatar":null,...}
```

### 1.4 前端登录弹窗交互（供插件 UI 参考）

- 首页右上角「登录」→ 弹出 Angular 组件 `.fenbi-login-modal-wrapper`
- 默认手机验证码登录；点右上角 `.fenbi-login-modal-qr-code-wrap` 切换二维码模式
- 二维码 DOM：`<div id="qrcode"><canvas width="270" height="270">`

---

## 2. 题库：分类与考点树 ✅

### 2.1 当前考试类目

```http
GET https://tiku.fenbi.com/activity/userexamcategory/getCurrent?noCacheTag=<时间戳>&app=web&kav=131&av=134&hav=128&version=3.0.0.0&deviceId=&gav=2&apcId=0
```

```json
{
  "code":1,
  "data":{
    "examCategoryId":1000009,
    "name":"单招",
    "path":["事考","笔试","安徽","单招"],
    "courses":[
      {"id":110,"name":"职测","prefix":"syzc"},
      {"id":1070,"name":"综应","prefix":"zhyynl"},
      {"id":100,"name":"公基","prefix":"sydw"}
    ],
    "currentCourse":{"id":110,"name":"职测","prefix":"syzc"}
  }
}
```
👉 **courseId → prefix 映射是拼接 exerciseKey 的关键**（见 3.1）。

### 2.2 考点树（选题入口）

```http
GET https://tiku.fenbi.com/api/syzc/categories/home?filter=keypoint&app=web&...&examcatid=1000009
```

```json
{"code":1,"data":{"baseKeypointVOS":[
  {"id":849974,"name":"政治理论","count":1892,"children":[
     {"id":850462,"name":"新思想","count":454,"children":[
        {"id":850477,"name":"新思想总论","count":104,"children":null}
     ]}
  ]}
]}}
```
- 三级结构：`baseKeypointVOS` → children → children（叶子节点 `children:null` 即可练）
- `count` = 该考点题目数；`answerCount` = 已做数
- 叶子节点前端渲染「去练习」按钮 → 触发 3.1 创建练习

### 2.3 错题/收藏/笔记数量

```http
GET https://tiku.fenbi.com/api/syzc/userCollectNoteError?type=u_error,u_note,u_collect&app=web&...&examcatid=1000009
```

---

## 3. 刷题主链路 ✅（全部实测跑通）

### 3.1 创建练习 ⭐

```http
POST https://tiku.fenbi.com/api/syzc/exercises?routecs=syzc&kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2
Content-Type: application/x-www-form-urlencoded

type=3&keypointId=849974&exerciseTimeMode=1
```

**`type` 取值（实测）**：

| type | 含义 | 效果 |
|---|---|---|
| `1` | Real 真题 | 需额外 `paperId`，否则报错 `未找到对应试题paperId:0` |
| `2` | 全真模拟（整卷） | 100 题 / 5400 秒，分章节（常识判断/言语/…） |
| **`3`** | **专项智能练习（考点练习）** ⭐ | 按 `keypointId` 出题，默认 **15 题** |
| `4`/`5` | 其他（返回空响应） | 待查 |

响应（关键字段）：
```json
{
  "key":"1_3e_2iqcpp0",          // ⭐ 练习 ID，后续所有接口都用它
  "id":2779146016,
  "userId":159027775,
  "status":0,
  "client":"WEB",
  "userAnswers":{},
  "sheet":{
    "id":2289573079,
    "keypointId":849974,
    "type":3,
    "name":"专项智能练习（政治理论）",
    "questionCount":15,
    "chapters":[{"name":null,"questionCount":15}],
    "questionIds":[10816952,1511086,...]
  }
}
```

#### exerciseKey 编码规则（推测，用于调试/校验）
格式 `{1}_{courseId转32进制}_{自增ID转32进制}`
- 职测 courseId=110 → `110..toString(32)` = **`3e`** → key 形如 `1_3e_2iqcpp0`
- 综应 1070 → `11e`；公基 100 → `34`
- 传非法 key 会报 `invalid hexString ... under radix 32`

### 3.2 获取练习元信息（含后续接口地址）⭐

```http
GET https://tiku.fenbi.com/combine/exercise/getExercise?format=html&key=1_3e_2iqcpp0&routecs=syzc&kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2
```

```json
{
  "code":1,
  "data":{
    "exerciseId":"1_3e_2iqcpp0",
    "name":"专项智能练习（政治理论）",
    "sheetType":3,
    "userAnswers":{},               // 已答内容
    "status":0,                     // 0=进行中 1=已交卷
    "feature":{"keypointId":"849974"},
    "updateUserAnswerUrl":"https://tiku.fenbi.com/combine/exercise/incrUpdate?key=1_3e_2iqcpp0",
    "submitUrl":"https://tiku.fenbi.com/combine/exercise/submit?key=1_3e_2iqcpp0",
    "createTime":1791452631124,
    "switchVO":{
      "flags":["draft","mark","collect","card"],
      "requestKey":"K1k2WODrWCe1oTEEsCLITeaTr4_...",   // ⭐ 题目内容凭证
      "pdf":{"type":1,"urls":["https://urlimg.fenbi.com/api/pdf/tiku/combine/exercise/1_3e_2iqcpp0?routecs=syzc&combineType=1"]}
    },
    "staticUrl":{"type":1,"urls":["https://tiku.fenbi.com/combine/static/exercise?key=<requestKey>"]}
  }
}
```
👉 **`requestKey` 是拿题目的钥匙**，也是 `collect/note/mark` 等接口的入参。

### 3.3 获取题目内容 ⭐

```http
GET https://tiku.fenbi.com/combine/static/exercise?key=<requestKey>&routecs=syzc&type=1&kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2&examcatid=1000009
```

```json
{
  "name":"专项智能练习（政治理论）",
  "materials":[],
  "questions":[
    {
      "id":17597634,
      "globalId":"3_3e_gp162",          // ⭐ 题目全局 ID，作答时用
      "tikuPrefix":"syzc",
      "content":"<p>题干HTML…</p><p><img src=\"//fb.fbstatic.cn/api/tarzan/images/18fb51c23296878.png?width=700\"/></p>",
      "type":1,                        // 1=单选题
      "accessories":[{
        "options":["选项A","选项B","选项C","选项D"],
        "type":101
      }]
    }
  ]
}
```
- **答题态只有题面，无答案**（答案在 3.6 解析接口）
- 材料题（资料分析/申论）走 `materials` 数组

### 3.4 提交单个/多个答案 ⭐

```http
POST https://tiku.fenbi.com/combine/exercise/incrUpdate?key=1_3e_2iqcpp0&routecs=syzc&kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2
Content-Type: application/json

[{"key":"3_3e_gp162","id":17597634,"prefix":"syzc","answer":{"choice":"0","type":201},"time":12}]
```

**请求体 = 数组**（可批量提交多题），元素字段：

| 字段 | 说明 |
|---|---|
| `key` | 题目 globalId，如 `3_3e_gp162` |
| `id` | 题目数字 id（questions[].id） |
| `prefix` | 科目前缀 `syzc` |
| `answer.choice` | **字符串下标**：`"0"`=A `"1"`=B `"2"`=C `"3"`=D |
| `answer.type` | `201`（单选/选择类） |
| `time` | 本题用时（秒） |

响应：`{"code":1,"data":true,"msg":"SUCCESS"}`
✅ 已验证写入（重新 getExercise 可见 `userAnswers` 更新）。

### 3.5 交卷 ⭐

```http
POST https://tiku.fenbi.com/combine/exercise/submit?key=1_3e_2iqcpp0&routecs=syzc&kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2&examcatid=1000009
```
- **请求体可为空**（实测空 body 也返回 `{"code":1,"data":true}`）；JS 源码里同源接口用 `status=1` 的 form body
- 交卷后 `status` 变 1，才允许取解析

### 3.6 查看解析 ⭐

```http
GET https://tiku.fenbi.com/combine/exercise/getSolution?format=html&key=1_3e_2iqcpp0&routecs=syzc&kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2
```
返回 `switchVO.requestKey`，再取：

```http
GET https://tiku.fenbi.com/combine/static/solution?key=<requestKey>&routecs=syzc&type=1&kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2&examcatid=1000009
```

```json
{
  "name":"专项智能练习（时事政治）",
  "solutions":[{
    "id":11624561,
    "globalId":"3_3e_b2o3h",
    "content":"<p>题干…</p>",
    "accessories":[{"options":["A…","B…","C…","D…"],"type":101}],
    "solution":"<p>本题考查…</p><p>A项正确…</p><p>故正确答案为B。</p>",
    "source":"2025年5月18日江苏省淮安市…笔试试题（网友回忆版）第4题",
    "keypoints":[{"id":814975,"name":"重要文件"}],
    "correctAnswer":{"choice":"1","type":201}      // ⭐ 正确答案 B
  }]
}
```
- 未交卷取解析会报 `{"code":-11,"msg":"练习还未提交"}`

#### ⭐ 快速智能练习 = 不传 keypointId

题库首页那三个大图卡片（`.info-block .info-item`）：

| 图标 class | 是什么 | 点后行为 |
|---|---|---|
| `.icon-exercice-blue` | **快速智能练习**（免费） | 直接创建并跳转 `spa.fenbi.com/ti/exam/exercise/{key}?routecs=syzc&examcatid=…` |
| `.icon-exercice-green` | 真题/套卷类 | 需会员，未开通时点不动 |
| `.icon-exercice-yellow` | 模考/其他 | 需会员，未开通时点不动 |

**复用同一个创建接口，只是不带 `keypointId`**：

```http
POST https://tiku.fenbi.com/api/syzc/exercises?routecs=syzc&app=web&kav=125&av=127&hav=125&deviceId=&gav=2&apcid=0
Content-Type: application/x-www-form-urlencoded

type=3&exerciseTimeMode=1          ← 没有 keypointId 就是快速练习
```

```json
{"key":"1_3e_2iqe6fe", "sheet":{"keypointId":0,"type":3,"name":"快速智能练习","questionCount":15}}
```

- `getExercise` 回读：`name="快速智能练习"`、`sheetType=3`、`feature={}`（无 keypointId）
- **题量恒定 15**：`count=10` / `count=5` 实测都被忽略，服务端仍返回 15 题
- 已验证完整链路：create → getExercise → static/exercise 拿到 15 题

#### ⚠️ 已交卷练习必须走 solution 链路（重要）

**已交卷（status=1）的练习，`getExercise` 返回的 `requestKey` 已失效**：

```json
// getExercise 结果
"userAnswers": {}                                    // 0 条，作答丢失
// static/exercise?key=<该 requestKey>
{"path":"/combine/static/exercise","msg":"invalid request key"}
```

正确做法：**`getSolution` + `static/solution` 一条龙，题目也从解析还原**

| 步骤 | 接口 | 拿到什么 |
|---|---|---|
| 1 | `getSolution?key=<exerciseKey>` | `switchVO.requestKey` + **`userAnswers`（每题作答，未答为 `answer:null`）** |
| 2 | `static/solution?key=<requestKey>` | `solutions[]`：题干 `content`、选项 `accessories[0].options`、正确答案 `correctAnswer.choice`、解析 `solution`、考点 `keypoints`、来源 `source` |
| 3 | `question/getMeta?requestKey=` | 每题全站正确率 `correctRatio`、易错项 `mostWrongAnswer.choice` |

即 `solutions[]` **自带题目内容**，不需要再调 `static/exercise`：
```
solutions[i] = { id, globalId, tikuPrefix, content, type,
                 accessories:[{options:[...], type:101}],
                 solution, source, keypoints,
                 correctAnswer:{choice:"1", type:201},
                 quizId, solutionAccessories }
```
✅ 已用 `key=1_3e_2iqcgc2`（status=1）实机验证：15 题全部还原成功。

### 3.7 练习报告（正确率/用时/考点统计）

```http
GET https://tiku.fenbi.com/combine/exercise/getReport?format=html&key=1_3e_2iqcpp0&routecs=syzc&no_toast&...
```

### 3.8 每题全站正确率 / 易错项

```http
GET https://tiku.fenbi.com/combine/question/getMeta?requestKey=<requestKey>&routecs=syzc&...
```
```json
{"3_3e_b2o3h":{"id":11624561,"totalCount":131945,"correctRatio":42.35,"mostWrongAnswer":{"choice":"2","type":201}}}
```

### 3.9 收藏 / 笔记 / 标记

| 功能 | 接口 |
|---|---|
| 查询收藏 | `GET /combine/collect/getCollect?requestKey=<requestKey>&routecs=syzc` |
| 查询标记 | `GET /combine/mark/getMark?exerciseKey=<key>&routecs=syzc` |
| 查询笔记 | `GET /combine/note/getNote?requestKey=<requestKey>&routecs=syzc` |
| 删除笔记 | `DELETE /tikuApi/{prefix}/notes/{id}` |
| 收藏列表 | `GET /tikuApi/{prefix}/collects?ids=a%2Cb` |

### 3.10 历史做题记录 ⭐

```http
GET https://tiku.fenbi.com/combine/exercise/getExerciseBriefHistory?noCacheTag=<ts>&categoryId=4&limit=20&cursor=&routecs=syzc&app=web&kav=125&av=127&hav=125&deviceId=&gav=2&apcid=0
```

```json
{"code":1,"data":{
  "cursor":"2739561299_9",              // 下一页游标，空=到底
  "historyItems":[{
    "exerciseId":2779136386,
    "exerciseKey":"1_3e_2iqcgc2",        // ⭐ 用它取题目/解析
    "sheetName":"专项智能练习（政治理论）",
    "sheetType":3,
    "difficulty":5.0,
    "status":1,                          // 0=未交卷(可续做) 1=已交卷 3=其他
    "updatedTime":1791452740199,
    "questionCount":15,
    "correctCount":0,
    "score":0.0,"fullScore":0.0,
    "hasVideo":0
  }]
}}
```
- `categoryId=4` 为官网固定取值；`limit` 可调；`cursor` 来自上一次响应的 `data.cursor`
- 点历史项 → `getExercise(key)` → 已交卷的再走 3.6 解析链路；未交卷的可继续 3.4/3.5

### 3.11 未完成的练习（续做入口）

```http
GET https://tiku.fenbi.com/api/syzc/category-exercises-unfinished?noCacheTag=<ts>&app=web&kav=131&av=134&hav=128&version=3.0.0.0&deviceId=&gav=2&apcId=0&examcatid=1000009
```
```json
{"combineKey":"1_3e_2iqcpp0","exerciseId":2779146016,"keypointIds":[849974],"sheetType":3}
```

### 3.12 学习时长上报

```http
POST https://tiku.fenbi.com/activity/report/studyTime?kav=125&av=127&hav=125&app=web&apcid=0&deviceId=&gav=2
```
刷题过程中周期性上报。

---

## 4. 题目图片 ✅

- 图片 URL 内嵌在 `content` / `solution` 的 **HTML `<img>`** 里：
```html
<img width="554px" height="230px" src="//fb.fbstatic.cn/api/tarzan/images/18fb51c23296878.png?width=700" />
```
- CDN 域名：`fb.fbstatic.cn`、`fb.fenbike.cn`（多域，正文里是什么就用什么）
- 路径规律：`/api/tarzan/images/{15位hex}.png?width={700}`，`width` 可调（控制清晰度）
- ✅ **无需 Cookie / 鉴权**，实测裸 fetch 返回 `200 image/png`
- 图片域名配置接口：`GET login.fenbi.com/api/pic/urls?url_type=https`（本次返回空 `{"urls":{},"status":1}`，实际域名来自正文中写死的值）

---

## 5. JS bundle 里挖到的其余接口（未逐一验证）

来源：`https://nodestatic.fbstatic.cn/weblts_spa_online/tiku/main.b9a1abbe2b3211e5.js`

```js
// 创建练习（form-urlencoded）
POST /tikuApi/{prefix}/exercises            body: "type=3&keypointId=849974&..."
// 按 id 取练习
GET  /tikuApi/{prefix}/exercises/{id}
// 逐题提交
POST /tikuApi/{prefix}/async/exercises/{key}/incr
// 交卷（body: "status=1"）
POST /tikuApi/{prefix}/async/exercises/{key}/submit
// 报告 v2
GET  /tikuApi/{prefix}/exercises/{key}/report/v2
// 题目/解析批量取（无需 exercise，直接按题 id）
GET  /tikuApi/{prefix}/universal/auth/{questions|solutions}?type={t}&{id|questionIds}={ids}
GET  /tikuApi/{prefix}/universal/questions?paperId={id}
GET  /tikuApi/{prefix}/questions?materialId={id}
// 元数据
GET  /tikuApi/{prefix}/question/meta?ids=a%2Cb
// 收藏/笔记
GET    /tikuApi/{prefix}/collects?ids=...
DELETE /tikuApi/{prefix}/notes/{id}
// 考点树
categorieseKeypointTree(...)
```

> 💡 `universal/auth/questions?questionIds=...` 这条很有价值：插件若拿到题目 ID 列表，可**跳过创建练习直接取题**。

---

## 6. 插件实现要点

1. **登录凭证是 HttpOnly Cookie**（domain `.fenbi.com`）
   - Chrome 插件：用 `chrome.cookies` API 读取 + `host_permissions` 声明 `*.fenbi.com`
   - IDEA 插件：需内嵌浏览器完成扫码登录，或让用户手动导出 Cookie
2. **跨域**：接口在 `tiku.fenbi.com`，页面在 `spa.fenbi.com`；插件需声明跨域权限
3. **两步取题目**：`getExercise` 拿 `requestKey` → `static/exercise` 拿题干（不能跳过）
4. **答案格式**：`choice` 是**字符串** `"0"~"3"`，`type: 201`
5. **刷题页面 URL**（供插件跳转/参考）：
   - 答题：`https://spa.fenbi.com/ti/exam/exercise/{key}?routecs=syzc&examcatid=1000009`
   - 解析：`https://spa.fenbi.com/ti/exam/solution/{key}?routecs=syzc&examcatid=1000009`
6. **科目前缀**：`syzc`(职测,110) / `zhyynl`(综应,1070) / `sydw`(公基,100)，切换科目 = 换 prefix + courseId 编码

---

## 7. Chrome 插件 v0.7.0：选项页与 AI 解析

### 7.1 设置页

- manifest：`"options_page": "options/options.html"`（在独立标签页打开）
- 入口：侧边栏顶栏 ⚙️ 齿轮 → `chrome.runtime.openOptionsPage()`
- 存储键：`chrome.storage.local.fenbiSettings`，结构：
  ```js
  { appearance: { theme: '' | 'light' | 'dark', accent: '#f2632a' },
    ai: { provider, baseUrl, apiKey, model, temperature, maxTokens,
          timeoutSec, useOfficial, extraHeaders, systemPrompt } }
  ```
- 侧边栏通过 `chrome.storage.onChanged` 实时接收，改完立即生效
- 兼容 0.6.x：旧键 `fenbiTheme` 首次读取时迁移到 `appearance.theme`

### 7.2 外观

- 主题色由 JS 写到 `<html style="--accent">`，`--brand` / `--brand-soft` 全部 `color-mix` 派生
- 深色下 `--brand = color-mix(in srgb, var(--accent) 84%, #fff)`，避免发闷
- 主题色上的文字色 `--on-accent` 按相对亮度算（L > 0.42 用黑字）
- 默认「粉笔橙」`#f2632a`，另有 8 个预设 + 取色器自定义

### 7.3 AI 解析

- 协议：**OpenAI 兼容**，`POST {baseUrl}/chat/completions`（SSE 流式）、`GET {baseUrl}/models`
- 预设平台（baseUrl 一律填到含版本号的前缀）：

  | key | 平台 | baseUrl |
  |---|---|---|
  | deepseek | DeepSeek | `https://api.deepseek.com/v1` |
  | openai | OpenAI | `https://api.openai.com/v1` |
  | qwen | 通义千问（百炼） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
  | glm | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` |
  | moonshot | Kimi | `https://api.moonshot.cn/v1` |
  | volc | 豆包（火山方舟） | `https://ark.cn-beijing.volces.com/api/v3`（模型填接入点 ID `ep-...`） |
  | siliconflow | 硅基流动 | `https://api.siliconflow.cn/v1` |
  | ollama | Ollama 本地 | `http://localhost:11434/v1`（Key 可留空） |
  | custom | 自定义 | 用户手填 |

- 生成参数：温度、最大输出 tokens、超时秒数、自定义请求头（JSON）、系统提示词
- 「附带官方解析」：把粉笔官方解析一起塞进 user message，讲解更准但更费 token
- 按钮位于「查看解析」**左侧**；生成中变「停止」（`AbortController`），失败变「重试」
- 缓存 `state.ai[globalId]`，重绘题目后自动恢复；换练习时 `resetAi()` 清空并中断

### 7.4 权限坑

MV3 下**扩展页（侧边栏 / 选项页）发起的跨域 fetch 必须有目标 host 权限**，否则被 CORS 拦。
做法：预设域名写进 `optional_host_permissions`（安装时不告警），用户点「保存 / 测试连接 / 拉取模型」
时用 `chrome.permissions.request()` 按需申请；自定义域名不在清单里时兜底申请通配 host 权限。
这一层封装在 `FenbiAI.ensurePermission(baseUrl)`。

---

## 8. 待补充

- [ ] `query_code_status` 的 `data:2`（已扫码未确认）实测确认
- [ ] 多选题 / 填空 / 申论（综应）类题目的 `answer` 结构（`type` 枚举）
- [ ] 错题本列表接口
- [ ] `type=4/5` 练习类型含义
- [ ] PDF 导出接口（`urlimg.fenbi.com/api/pdf/...`）
