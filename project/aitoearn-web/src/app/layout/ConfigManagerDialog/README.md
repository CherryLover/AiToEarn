# ConfigManagerDialog

**已经不是弹窗了。** 配置管理的界面搬到了独立页面 `src/app/[lng]/config/`，那里是唯一实现。

这个目录只剩一个跳转壳子：由 `src/app/layout/Providers.tsx` 挂载，
被 `src/store/configManagerDialog.ts` 请求「打开」时，关掉开关并跳到 `/[lng]/config`。

## 边界

- 这里**不允许**再出现配置读取、校验、保存、重启或任何表单实现；要改界面去页面目录。
- 现有的两个调用方不用动：侧边栏的配置管理入口、接口报错提示里的「点击查看配置」。
- 目录名和 store 名保留是为了不牵动调用方；等调用方改成直接用 `Link` 跳页面，这个壳子就可以删掉。
