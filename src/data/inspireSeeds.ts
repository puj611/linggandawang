// src/data/inspireSeeds.ts
// 灵感广场种子库：按三模式分类，用户点击一键填充输入框
// 数据来源：基于公开提示词工程实践与常见业务场景提炼

import type { SceneType } from '@/engine/types';

/** 灵感种子模板 */
export interface SeedTemplate {
  id: string;
  /** 对齐三模式场景类型 */
  category: SceneType;
  /** 简短标题（按钮文字） */
  title: string;
  /** 种子输入文本（填充到输入框） */
  seed: string;
  /** 可选描述（hover 提示） */
  description?: string;
}

/**
 * 灵感种子库
 * 每类 10 个，覆盖常见业务场景，种子文本应能触发对应场景的关键词检测
 * 数据来源：基于公开提示词工程实践与常见业务场景提炼
 */
export const INSPIRE_SEEDS: SeedTemplate[] = [
  // ===== PPT 模式 =====
  {
    id: 'ppt-001',
    category: 'ppt',
    title: '创业路演',
    seed: '创业项目路演 PPT，面向投资人，10 分钟讲解商业模式与融资需求',
    description: '大赛展示/融资路演场景',
  },
  {
    id: 'ppt-002',
    category: 'ppt',
    title: '产品发布',
    seed: '新产品发布会演示文稿，介绍核心功能、用户价值与市场定位',
    description: '产品发布/功能介绍场景',
  },
  {
    id: 'ppt-003',
    category: 'ppt',
    title: '季度汇报',
    seed: '季度业绩汇报 PPT，面向管理层，包含数据图表与下季度规划',
    description: '商务风/业绩汇报场景',
  },
  {
    id: 'ppt-004',
    category: 'ppt',
    title: '技术分享',
    seed: '技术分享沙龙幻灯片，主题为前端架构演进，面向开发者',
    description: '教学演示/技术分享场景',
  },
  {
    id: 'ppt-005',
    category: 'ppt',
    title: '行业趋势',
    seed: '行业趋势分析演示文稿，面向决策者，包含市场数据与战略建议',
    description: '主题聚焦/趋势分析场景',
  },
  {
    id: 'ppt-006',
    category: 'ppt',
    title: '培训课件',
    seed: '新员工入职培训 PPT，介绍公司文化与工作流程，15 页',
    description: '培训/教学场景',
  },
  {
    id: 'ppt-007',
    category: 'ppt',
    title: '年终总结',
    seed: '年终总结汇报 PPT，回顾全年关键成果、数据对比与明年规划',
    description: '年终复盘/总结汇报场景',
  },
  {
    id: 'ppt-008',
    category: 'ppt',
    title: '项目复盘',
    seed: '项目复盘演示文稿，包含项目背景、执行过程、问题分析与经验沉淀',
    description: '项目复盘/经验沉淀场景',
  },
  {
    id: 'ppt-009',
    category: 'ppt',
    title: '品牌发布',
    seed: '品牌战略发布会幻灯片，介绍品牌升级、视觉系统与传播计划',
    description: '品牌/公关发布场景',
  },
  {
    id: 'ppt-010',
    category: 'ppt',
    title: '竞品分析',
    seed: '竞品分析报告 PPT，对比 3-5 家竞品的功能、定价与市场策略',
    description: '竞品调研/市场分析场景',
  },
  {
    id: 'ppt-011',
    category: 'ppt',
    title: '公司介绍',
    seed: '公司介绍演示文稿，展示业务范围、团队实力、合作案例与联系方式',
    description: '企业宣传/合作接洽场景',
  },
  {
    id: 'ppt-012',
    category: 'ppt',
    title: '学术答辩',
    seed: '毕业论文答辩 PPT，包含研究背景、方法、实验数据与结论展望',
    description: '学术答辩/研究汇报场景',
  },
  {
    id: 'ppt-013',
    category: 'ppt',
    title: '营销提案',
    seed: '营销方案提案 PPT，面向客户，阐述推广策略、预算分配与预期效果',
    description: '营销/广告提案场景',
  },
  {
    id: 'ppt-014',
    category: 'ppt',
    title: '产品教程',
    seed: '产品使用教程幻灯片，分步骤讲解核心功能，配截图与操作提示',
    description: '用户教育/帮助文档场景',
  },
  {
    id: 'ppt-015',
    category: 'ppt',
    title: '节日活动',
    seed: '节日营销活动方案 PPT，含活动主题、玩法规则、奖品设置与传播节奏',
    description: '节日/活动策划场景',
  },

  // ===== 前端 UI 模式 =====
  {
    id: 'fe-001',
    category: 'frontend-ui',
    title: 'SaaS 落地页',
    seed: 'SaaS 产品官网首页落地页，突出核心卖点与注册转化',
    description: 'Landing Page/营销页场景',
  },
  {
    id: 'fe-002',
    category: 'frontend-ui',
    title: '数据仪表盘',
    seed: '后台管理数据仪表盘，含折线图、柱状图、数据卡片与筛选器',
    description: 'Dashboard/数据可视化场景',
  },
  {
    id: 'fe-003',
    category: 'frontend-ui',
    title: '登录注册',
    seed: '注册登录流程页面，含表单校验、第三方登录与忘记密码',
    description: '表单/认证流程场景',
  },
  {
    id: 'fe-004',
    category: 'frontend-ui',
    title: '商品详情',
    seed: '电商商品详情页，含图片轮播、规格选择、加购与立即购买',
    description: '详情页/电商场景',
  },
  {
    id: 'fe-005',
    category: 'frontend-ui',
    title: '个人设置',
    seed: '个人中心设置页，含头像修改、密码修改、通知偏好与账号绑定',
    description: '设置页/表单场景',
  },
  {
    id: 'fe-006',
    category: 'frontend-ui',
    title: '内容列表',
    seed: '文章内容列表页，含分类筛选、搜索框、卡片布局与分页',
    description: '列表页/内容展示场景',
  },
  {
    id: 'fe-007',
    category: 'frontend-ui',
    title: '实时监控',
    seed: '实时数据监控大屏，深色主题，含实时折线、地图分布与告警列表',
    description: '大屏/实时监控场景',
  },
  {
    id: 'fe-008',
    category: 'frontend-ui',
    title: '管理后台',
    seed: '企业管理后台布局，含侧边栏导航、顶部搜索、表格列表与批量操作',
    description: 'Admin/后台管理场景',
  },
  {
    id: 'fe-009',
    category: 'frontend-ui',
    title: '营销活动',
    seed: '促销活动落地页，含倒计时、奖品展示、参与按钮与规则说明',
    description: '活动页/营销转化场景',
  },
  {
    id: 'fe-010',
    category: 'frontend-ui',
    title: '聊天界面',
    seed: '即时通讯聊天界面，含会话列表、消息气泡、输入框与表情面板',
    description: 'IM/聊天场景',
  },
  {
    id: 'fe-011',
    category: 'frontend-ui',
    title: '拖拽看板',
    seed: 'Trello 风格拖拽看板，多列任务卡片，支持拖拽、筛选与标签',
    description: '看板/任务管理场景',
  },
  {
    id: 'fe-012',
    category: 'frontend-ui',
    title: '视频播放',
    seed: '在线视频播放页，含自定义播放器、播放列表、弹幕与画质切换',
    description: '视频/媒体播放场景',
  },
  {
    id: 'fe-013',
    category: 'frontend-ui',
    title: '日历组件',
    seed: '月视图日历组件，含日期选择、事件标记、拖拽创建与农历显示',
    description: '日历/日程场景',
  },
  {
    id: 'fe-014',
    category: 'frontend-ui',
    title: '文件预览',
    seed: '在线文件预览页，支持 PDF/Word/Excel 格式，含缩略图、翻页与下载',
    description: '文档/文件查看场景',
  },
  {
    id: 'fe-015',
    category: 'frontend-ui',
    title: '地图导航',
    seed: '地图导航界面，含位置标记、路线规划、周边搜索与实时路况',
    description: '地图/LBS 场景',
  },

  // ===== 后端 API 模式 =====
  {
    id: 'be-001',
    category: 'backend-api',
    title: '用户鉴权',
    seed: '用户登录注册接口，JWT 鉴权，含刷新 token 与登出',
    description: '认证/鉴权场景',
  },
  {
    id: 'be-002',
    category: 'backend-api',
    title: 'CRUD 接口',
    seed: '文章资源增删改查 RESTful 接口，含分页、排序与筛选',
    description: '资源 CRUD 场景',
  },
  {
    id: 'be-003',
    category: 'backend-api',
    title: '文件上传',
    seed: '图片上传接口，含大小限制、格式校验、压缩与 CDN 回传',
    description: '文件处理场景',
  },
  {
    id: 'be-004',
    category: 'backend-api',
    title: '数据导出',
    seed: '订单数据导出接口，支持 Excel/CSV 格式，异步生成与下载',
    description: '数据导出/异步任务场景',
  },
  {
    id: 'be-005',
    category: 'backend-api',
    title: '消息推送',
    seed: '站内消息推送接口，支持批量发送、已读未读与消息列表',
    description: '消息/通知场景',
  },
  {
    id: 'be-006',
    category: 'backend-api',
    title: '支付回调',
    seed: '支付回调接口，含签名校验、订单状态更新与幂等处理',
    description: '支付/回调场景',
  },
  {
    id: 'be-007',
    category: 'backend-api',
    title: '搜索接口',
    seed: '全文搜索接口，支持关键词高亮、分词、相关度排序与筛选',
    description: '搜索/检索场景',
  },
  {
    id: 'be-008',
    category: 'backend-api',
    title: '推荐接口',
    seed: '内容推荐接口，基于用户画像与行为数据返回个性化推荐列表',
    description: '推荐/个性化场景',
  },
  {
    id: 'be-009',
    category: 'backend-api',
    title: '统计接口',
    seed: '数据统计聚合接口，按时间维度返回 PV/UV/转化率等核心指标',
    description: '统计/数据分析场景',
  },
  {
    id: 'be-010',
    category: 'backend-api',
    title: '权限管理',
    seed: 'RBAC 权限管理接口，含角色、权限、资源三者关联与鉴权中间件',
    description: '权限/RBAC 场景',
  },
  {
    id: 'be-011',
    category: 'backend-api',
    title: 'WebSocket',
    seed: 'WebSocket 实时通讯接口，含心跳保活、断线重连与消息广播',
    description: '长连接/实时通讯场景',
  },
  {
    id: 'be-012',
    category: 'backend-api',
    title: '限流接口',
    seed: '接口限流防刷接口，支持 IP/用户/接口多维度令牌桶与滑动窗口',
    description: '限流/防刷场景',
  },
  {
    id: 'be-013',
    category: 'backend-api',
    title: '分布式锁',
    seed: '分布式锁接口，基于 Redis 实现库存扣减防超卖与幂等控制',
    description: '并发/分布式场景',
  },
  {
    id: 'be-014',
    category: 'backend-api',
    title: '定时任务',
    seed: '定时任务调度接口，支持 Cron 表达式、任务日志、失败重试与手动触发',
    description: '任务调度/批处理场景',
  },
  {
    id: 'be-015',
    category: 'backend-api',
    title: 'API 网关',
    seed: 'API 网关路由配置接口，含鉴权转发、限流熔断、灰度发布与监控埋点',
    description: '网关/服务治理场景',
  },
];

/** 根据当前场景选择过滤种子 */
export function getSeedsByScene(scene: SceneType): SeedTemplate[] {
  return INSPIRE_SEEDS.filter((s) => s.category === scene);
}
