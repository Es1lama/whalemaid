// SPEC: docs/PREFLIGHT.md 中继控制面（rathole sidecar 管理，ADR-032）
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct RelayConfig {
    /// 控制面管理 API 监听（仅本机插件/控制台调用）
    pub listen: String,
    /// 数据目录（设备注册表 JSON）
    pub data_dir: PathBuf,
    /// rathole 服务端二进制路径（sidecar）
    pub rathole_bin: PathBuf,
    /// 生成给 rathole 的服务端配置文件路径
    pub rathole_server_cfg: PathBuf,
    /// rathole 服务端控制端口（设备服务转发端口由注册时分配）
    pub rathole_bind: String,
    /// 主控端隧道入口（TLS + 一次性 grant 校验后转发到 rathole 服务端口；SEC-004b）
    pub tunnel_listen: String,
}

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            listen: "127.0.0.1:9080".into(),
            data_dir: PathBuf::from("./data"),
            rathole_bin: PathBuf::from("rathole"),
            rathole_server_cfg: PathBuf::from("./data/rathole-server.toml"),
            rathole_bind: "0.0.0.0:2333".into(),
            tunnel_listen: "127.0.0.1:9443".into(),
        }
    }
}
