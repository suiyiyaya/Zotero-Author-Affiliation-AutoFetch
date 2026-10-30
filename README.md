# Zotero Author Affiliation AutoFetch

一个面向 Zotero 10 的插件项目：根据文献 DOI，从 OpenAlex 获取逐作者署名与机构信息，并将结果保存为该文献的子笔记。Crossref 用作补充数据源。

> 当前状态：项目初始化 / MVP 开发中。尚未完成 Zotero 10 实机验证，也尚未发布可安装的 XPI。请勿将当前代码视为稳定发行版。

## 目标功能

- DOI 优先匹配 OpenAlex Work。
- 以 OpenAlex 的 `authorships` 为核心，按数组顺序生成作者序号，保留原始作者姓名、数据库显示名、ORCID、原始单位字符串、机构名称/ID、国家/地区及通讯作者标记。
- OpenAlex 无结果或无单位信息时，尝试使用 Crossref 的作者与单位字段补充。
- 每篇文献生成一个可更新的子笔记，记录来源与抓取时间。
- 不按作者姓名猜测单位；不把无法可靠对应的机构强行分配给作者。
- 后续版本计划提供手动抓取、批量抓取、设置界面、失败重试和 CSV 导出。

## 数据来源

1. OpenAlex Works API：读取 Work 的 `authorships`、`raw_author_name`、`raw_affiliation_strings`、`affiliations`、`institutions`、`is_corresponding`。
2. Crossref Works API：读取 `author[].name` 与 `author[].affiliation[].name`，仅作为补充。

OpenAlex 文档：
- https://help.openalex.org/data/authorships/
- https://help.openalex.org/api/

Crossref 文档：
- https://www.crossref.org/documentation/retrieve-metadata/rest-api/

## 当前开发状态

- [x] 创建项目仓库与基础结构
- [x] 明确作者—单位映射的数据原则
- [x] 完成基础插件生命周期与条目监听（需 Zotero 10 实机验证）
- [x] 完成 OpenAlex DOI 查询与作者署名读取（需实测接口兼容性）
- [x] 完成 Crossref 备用查询（需实测接口兼容性）
- [x] 完成子笔记创建、更新与基础去重逻辑（需实测）
- [x] 改进作者字段解析、机构 ID 归并信息展示及通讯作者标记（需 Zotero 10 实测）
- [x] 增加返回 DOI 一致性检查，避免将错误 DOI 的记录写入文献
- [ ] 增加手动抓取与批量处理
- [x] 增加 JavaScript 语法检查与 XPI 打包工作流
- [ ] 在 Zotero 10 Windows 环境实测
- [ ] 构建并发布 XPI

## 开发与安装

当前代码已包含基础自动抓取流程：监听文献新增及元数据修改事件；检测到 DOI 后先查 OpenAlex，再尝试 Crossref 补充；将逐作者原始单位、机构、ORCID、国家/地区及通讯作者信息写入文献子笔记。作者序号以 authorships 数组顺序为准，不直接把 first/middle/last 当作序号。Crossref 仅在规范化姓名唯一精确匹配且 OpenAlex 未提供单位时补充。\n\nGitHub Actions 会在推送到 main 或提交 PR 时执行 JavaScript 语法检查并生成 XPI 构建产物。可在仓库的 **Actions → 对应工作流 → Artifacts** 下载测试包。发布版本时推送 `v*` 标签，工作流会将 XPI 附加到 GitHub Release。\n\n**注意：** 当前尚未在 Zotero 10 Windows 环境实机验证，不建议直接用于唯一/重要文献库。当前没有设置界面、手动抓取按钮或批量抓取入口；这些列为后续功能。

## 隐私

插件只会根据文献 DOI 向 OpenAlex / Crossref 请求公开书目元数据。不会上传 Zotero 附件或 PDF 内容。正式版本将提供数据源开关与请求失败提示。

## License

MIT
