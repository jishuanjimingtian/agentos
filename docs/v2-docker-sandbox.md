# Sentinel AgentOS V2.0 — Docker Sandbox

## 设计目标

将现有进程级沙箱升级为 **Docker 容器级隔离**：

| 维度 | V1 沙箱 | V2 Docker 沙箱 |
|------|---------|---------------|
| 文件系统 | 路径校验 | 挂载只读 volume |
| 网络 | 白名单域名 | iptables/nftables 容器策略 |
| 进程 | 正则监控命令 | cgroup 限制 CPU/Mem |
| 回滚 | git checkout | 容器销毁即回滚，零副作用 |
| 安全边界 | 同进程 | 独立 namespace |

## 接口设计

```typescript
// V2 新增
new SandboxExecutor({
  mode: 'container',           // 'direct' | 'sandbox' | 'container' | 'dry-run'
  image: 'node:24-alpine',    // 基础镜像
  workspaceVolume: 'ro',       // 挂载模式
  network: 'none',             // none | host | bridge
  memoryLimit: '512m',
  cpuLimit: 0.5,               // 0.5 core
  timeoutSec: 30,
  autoRemove: true,            // 执行完自动销毁
});
```
