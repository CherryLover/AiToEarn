#!/usr/bin/env python3
"""把官方 config.yaml 和本目录 overrides/*.yaml 合并成服务器上实际用的配置。

- overrides 里的 ${VAR} 从环境变量取（deploy.sh 会先加载 .env），缺变量直接报错
- override 的值是空字符串时跳过，保留官方默认值（比如还没给 AI 的 Key）
- server 配置里所有 https://localhost/ 开头的地址换成 https://$DOMAIN/（各平台授权回调等）
- oidcLogin 没填 clientId 时整段去掉（否则后台配置校验不过、起不来；此时只是暂时不能登录）；allowedEmails 写成逗号分隔字符串，这里拆成列表
- 输出文件权限 600，里面有密码

用法：render_config.py <官方配置> <override 模板> <输出文件>
"""
import os
import string
import sys

import re

import yaml


class Yaml12Loader(yaml.SafeLoader):
    """按 YAML 1.2 解析，和后台读配置的库保持一致。

    PyYAML 默认是 YAML 1.1：`16:9` 会被当成六十进制数字 969，`on`/`yes` 会变成 true，
    日期会变成 datetime。后台按 1.2 读，这些都是字符串，不改就会校验失败。
    """


_REPLACED = {"tag:yaml.org,2002:bool", "tag:yaml.org,2002:int", "tag:yaml.org,2002:float", "tag:yaml.org,2002:timestamp"}
Yaml12Loader.yaml_implicit_resolvers = {
    first: [r for r in resolvers if r[0] not in _REPLACED]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
Yaml12Loader.add_implicit_resolver(
    "tag:yaml.org,2002:bool", re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF"))
Yaml12Loader.add_implicit_resolver(
    "tag:yaml.org,2002:int", re.compile(r"^(?:[-+]?[0-9]+|0x[0-9a-fA-F]+)$"), list("-+0123456789"))
Yaml12Loader.add_implicit_resolver(
    "tag:yaml.org,2002:float",
    re.compile(r"^(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$"),
    list("-+0123456789."))


def prune(value):
    """去掉空字符串和空值（YAML 里 `key: ` 会解析成 None）"""
    if isinstance(value, dict):
        return {k: prune(v) for k, v in value.items() if v != "" and v is not None}
    return value


def merge(base, override):
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        elif value == "" or value is None:
            continue
        else:
            base[key] = prune(value)


def replace_localhost(node, domain):
    if isinstance(node, dict):
        return {k: replace_localhost(v, domain) for k, v in node.items()}
    if isinstance(node, list):
        return [replace_localhost(v, domain) for v in node]
    if isinstance(node, str) and node.startswith("https://localhost/"):
        return f"https://{domain}/" + node[len("https://localhost/"):]
    return node


def main():
    base_path, override_path, out_path = sys.argv[1:4]
    with open(base_path, encoding="utf-8") as f:
        base = yaml.load(f, Loader=Yaml12Loader)
    with open(override_path, encoding="utf-8") as f:
        text = string.Template(f.read()).substitute(os.environ)
    merge(base, yaml.load(text, Loader=Yaml12Loader) or {})
    base = replace_localhost(base, os.environ["DOMAIN"])
    oidc = base.get("oidcLogin")
    if isinstance(oidc, dict):
        if not oidc.get("clientId"):
            del base["oidcLogin"]
        elif isinstance(oidc.get("allowedEmails"), str):
            oidc["allowedEmails"] = [m.strip() for m in oidc["allowedEmails"].split(",") if m.strip()]

    tmp = out_path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        yaml.safe_dump(base, f, allow_unicode=True, sort_keys=False, width=1000)
    os.replace(tmp, out_path)


if __name__ == "__main__":
    main()
