# Zotero Author Affiliation AutoFetch

一个面向 Zotero 10 的插件项目：根据文献 DOI，从 OpenAlex 获取逐作者署名与机构信息，并将结果保存为该文献的子笔记。Crossref 用作补充数据源。

> 当前状态：项目初始化 / MVP 开发中。尚未完成 Zotero 10 实机验证，也尚未发布可安装的 XPI。请勿将当前代码视为稳定发行版。

## 目标功能

- DOI 优先匹配 OpenAlex Work。
- 以 OpenAlex 的 `authorships` 为核心，保留作者署名顺序、原始作者姓名、原始单位字符串、机构信息及通讯作者标记。
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
- [ ] 完成 Zotero 10 插件生命周期与界面接入
- [ ] 完成 OpenAlex 查询与解析
- [ ] 完成 Crossref 补充查询
- [ ] 完成子笔记创建、更新与去重
- [ ] 增加手动抓取与批量处理
- [ ] 增加自动化测试
- [ ] 在 Zotero 10 Windows 环境实测
- [ ] 构建并发布 XPI

## 开发与安装

开发环境和打包流程将在确认 Zotero 10 的插件 API 与兼容性后补齐。当前版本没有可供最终用户安装的 XPI。

## 隐私

插件只会根据文献 DOI 向 OpenAlex / Crossref 请求公开书目元数据。不会上传 Zotero 附件或 PDF 内容。正式版本将提供数据源开关与请求失败提示。

## License

MIT
