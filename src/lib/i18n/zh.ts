import type { Messages } from "./en";

// Simplified Chinese UI chrome. Typed as Messages, so a missing/extra key fails
// the build. Product name "PBudget" and user data (vendor/category/txn names)
// are never translated.
const zh: Messages = {
  // nav
  "nav.dashboard": "仪表板",
  "nav.review": "审核",
  "nav.report": "报告",
  "nav.budget": "预算",
  "nav.categories": "分类",
  "nav.billing": "账单",
  "nav.login": "登录",
  "nav.signup": "注册",
  "nav.logout": "退出登录",

  // common
  "common.loading": "加载中…",
  "common.cancel": "取消",
  "common.save": "保存",
  "common.saving": "保存中…",
  "common.reset": "重置",
  "common.subscribe": "订阅",
  "common.requestFailed": "请求失败",
  "common.genericError": "出错了",

  // auth
  "auth.signupTitle": "创建您的账户",
  "auth.loginTitle": "欢迎回来",
  "auth.email": "邮箱",
  "auth.password": "密码",
  "auth.haveAccount": "已有账户？",
  "auth.newHere": "第一次来？",
  "auth.createAccount": "创建账户",

  // verify
  "verify.verifiedTitle": "邮箱已验证 ✓",
  "verify.verifiedBody": "您的账户现已激活。",
  "verify.goDashboard": "前往仪表板",
  "verify.invalidTitle": "链接无效或已过期",
  "verify.invalidBody": "请在下方申请新的验证链接。",
  "verify.alreadyTitle": "您已验证 ✓",
  "verify.title": "验证您的邮箱",
  "verify.body": "我们已向 {email} 发送了验证链接。点击它以激活您的账户。（在本地开发环境中，链接会打印到服务器控制台。）",
  "verify.yourInbox": "您的收件箱",

  // resend
  "resend.button": "重新发送验证邮件",
  "resend.sent": "验证邮件已发送。",
  "resend.failed": "发送失败——您登录了吗？",

  // dashboard
  "dashboard.title": "您的银行",
  "dashboard.bannerTitle": "开始订阅",
  "dashboard.bannerBody": "——每个管理账户每月 $1。您需要有效的订阅才能连接和同步账户。",
  "dashboard.noBanks": "尚未连接任何银行。",
  "dashboard.colBank": "银行",
  "dashboard.colAccounts": "账户数",
  "dashboard.colLastUpdated": "最后更新",
  "dashboard.colActions": "操作",
  "dashboard.sync": "同步",
  "dashboard.reauth": "重新授权",
  "dashboard.connect": "连接银行账户",
  "dashboard.viewBudget": "查看预算规划",

  // billing
  "billing.title": "账单",
  "billing.subtitle": "每个管理账户每月 $1。",
  "billing.status": "状态",
  "billing.statusNone": "无",
  "billing.managedAccounts": "管理的账户",
  "billing.estimatedMonthly": "预计每月",
  "billing.manage": "管理账单",

  // item detail
  "item.updated": "更新于",
  "item.colAccount": "账户",
  "item.colCurrent": "当前余额",
  "item.colTransactions": "交易数",
  "item.colLastUpdated": "最后更新",

  // transaction table fields + group badge
  "field.name": "交易名称",
  "field.merchant": "商户名称",
  "field.category": "分类",
  "field.amount": "金额",
  "field.date": "日期",
  "field.lastUpdated": "最后更新",
  "field.bank": "银行",
  "field.account": "账户",
  "txn.groupBadge": "合并 · {n}",
  "txn.groupTooltip": "{n} 笔交易的合并组",

  // budget
  "budget.title": "预算规划",
  "budget.empty": "暂无交易——请在仪表板连接并同步银行。",
  "budget.colMonth": "月份",
  "budget.colTotal": "总计（不含收入和转账）",
  "budget.colCategory": "分类",
  "budget.colSpent": "已花费",
  "budget.colBudget": "预算",
  "budget.colUsage": "使用率",
  "budget.colTransactions": "交易数",
  "budget.na": "不适用",

  // report
  "report.title": "月度报告",
  "report.month": "月份",
  "report.noActivity": "本月无活动。",
  "report.cashFlow": "现金流",
  "report.moneyIn": "收入",
  "report.moneyOut": "支出",
  "report.net": "净额",
  "report.flagsThisMonth": "本月标记",
  "report.open": "待处理",
  "report.resolved": "已处理",
  "report.category": "分类",
  "report.spend": "支出",
  "report.noSpend": "本月无分类支出。",

  // review
  "review.title": "审核",
  "review.suspiciousToday": "今日可疑",
  "review.thisMonth": "本月",
  "review.totalOpen": "待处理总数",
  "review.filter": "筛选",
  "review.allDates": "所有日期",
  "review.byDay": "按日",
  "review.byMonth": "按月",
  "review.mergeTransactions": "合并交易…",
  "review.allClear": "全部处理完毕",
  "review.allClearBody": "没有待处理的标记，也没有等待确认的合并组。",
  "review.noMatch": "没有符合此筛选的标记。",
  "review.pendingGroups": "自动匹配的合并组——待确认（{n}）",
  "review.colGroup": "合并组",
  "review.colNet": "净额",
  "review.colDate": "日期",
  "review.colActions": "操作",
  "review.colItem": "项目",
  "review.colAmount": "金额",
  "review.confirm": "确认",
  "review.dissolve": "解散",
  "review.mergedGroup": "合并组",
  "review.approveVendor": "批准商户",
  "review.reject": "拒绝",
  "review.merge": "合并…",
  "review.dismiss": "忽略",

  // review — rule labels
  "rule.unknown_vendor": "未知商户",
  "rule.unmatched_transfer": "未匹配转账",
  "rule.unusual_amount": "异常金额",
  "rule.duplicate_charge": "重复扣款",

  // review — vendor status
  "status.approved": "已批准",
  "status.rejected": "已拒绝",
  "status.pending": "待处理",

  // merge picker
  "merge.title": "合并交易",
  "merge.help": "选择两笔或以上已入账交易，合并为一组。",
  "merge.optionalTitle": "可选的合并组标题",
  "merge.loading": "正在加载候选交易…",
  "merge.none": "没有可合并的交易。",
  "merge.mergeSelected": "合并所选 {n} 笔",
  "merge.loadFailed": "加载候选交易失败",
  "merge.failed": "合并失败",

  // category mapping
  "catmap.title": "分类映射",
  "catmap.help": "将任意 Plaid 分类重命名为您自己的分类。更改会应用到所有地方，包括过去的月份。",
  "catmap.loadFailed": "加载分类失败。",
  "catmap.saveFailed": "保存失败。",
  "catmap.colPlaid": "Plaid 分类",
  "catmap.colYours": "您的分类",
  "catmap.overridden": "已覆盖",
};

export default zh;
