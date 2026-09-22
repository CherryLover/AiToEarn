#!/usr/bin/env python3
"""把官方 config.yaml 和本目录 overrides/*.yaml 合并成服务器上实际用的配置。

- overrides 里的 ${VAR} 从环境变量取（deploy.sh 会先加载 .env）。
  .env 里没有但 .env.example 里有 = 服务器上的 .env 比仓库旧，按留空处理并逐个点名；
  两边都没有 = 模板里的变量名写错了，直接报错
- override 的值是空字符串时跳过，保留官方默认值（比如还没给 AI 的 Key）
- server 配置里所有 https://localhost/ 开头的地址换成 https://$DOMAIN/（各平台授权回调等）
- oidcLogin 没填 clientId 时整段去掉（否则后台配置校验不过、起不来；此时只是暂时不能登录）；allowedEmails 写成逗号分隔字符串，这里拆成列表
- agent.models 也是逗号分隔字符串，拆成列表；三个角色模型没单独指定就取清单第一个，指定了但不在清单里直接报错（后台 zod 也会拦，但那时是容器起不来）
- agent.transformers 同样是逗号分隔字符串；`none` 拆成空列表（明确不要 transformer），留空则整项跳过、沿用默认
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


ENV_EXAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.example")


def declared_in_example():
    """.env.example 里声明过的变量名。它是用户 .env 的来源，所以也是「这个变量该不该存在」的依据。"""
    names = set()
    try:
        with open(ENV_EXAMPLE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    names.add(line.split("=", 1)[0].strip())
    except OSError:
        pass
    return names


def substitute(text, override_path):
    """把模板里的 ${VAR} 换成环境变量。

    缺变量分两种，后果完全不同，所以不能一视同仁：

    - **模板里写错了变量名**（.env.example 里也没有）：报错。这是仓库自己的 bug，
      渲染成空只会让它在几层之后变成一条看不懂的启动失败。
    - **服务器上的 .env 比仓库旧**（.env.example 里有）：按留空处理，逐个点名。
      这是常态，每次往 .env.example 加变量都会撞上一次；为此让整个部署停摆，
      等于每加一个可选配置就把线上卡死一次。留空的项会被 prune 掉、沿用官方默认，
      缺了什么进站横幅和 /setup 会说，也可以直接在网页 /config 里补。
    """
    template = string.Template(text)
    referenced = set()
    for match in template.pattern.finditer(text):
        name = match.group("named") or match.group("braced")
        if name:
            referenced.add(name)

    missing = sorted(name for name in referenced if name not in os.environ)
    if missing:
        declared = declared_in_example()
        unknown = [name for name in missing if name not in declared]
        if unknown:
            sys.exit(
                f"✗ {override_path} 用到的变量 .env.example 里也没有，多半是名字写错了：\n"
                + "\n".join(f"    {name}" for name in unknown)
            )
        print(
            f"! {os.path.basename(override_path)}：.env 里缺下面这些，按留空处理"
            f"（.env.example 里有，说明服务器上的 .env 比仓库旧）：",
            file=sys.stderr,
        )
        for name in missing:
            print(f"    {name}", file=sys.stderr)
        print(f"  要补就照着 {ENV_EXAMPLE} 加进 .env 再跑一次，或者到网页 /config 里配", file=sys.stderr)

    values = {name: "" for name in missing}
    values.update(os.environ)
    return template.substitute(values)


def main():
    base_path, override_path, out_path = sys.argv[1:4]
    with open(base_path, encoding="utf-8") as f:
        base = yaml.load(f, Loader=Yaml12Loader)
    with open(override_path, encoding="utf-8") as f:
        text = substitute(f.read(), override_path)
    merge(base, yaml.load(text, Loader=Yaml12Loader) or {})
    base = replace_localhost(base, os.environ["DOMAIN"])
    oidc = base.get("oidcLogin")
    if isinstance(oidc, dict):
        if not oidc.get("clientId"):
            del base["oidcLogin"]
        elif isinstance(oidc.get("allowedEmails"), str):
            oidc["allowedEmails"] = [m.strip() for m in oidc["allowedEmails"].split(",") if m.strip()]

    agent = base.get("agent")
    if isinstance(agent, dict):
        role_fields = (
            ("defaultModel", "AGENT_DEFAULT_MODEL"),
            ("backgroundModel", "AGENT_BACKGROUND_MODEL"),
            ("thinkModel", "AGENT_THINK_MODEL"),
        )
        # transformers：`none` 表示明确不要 transformer（上游是 OpenAI 协议，让 router 自己转），
        # 留空表示不覆盖、沿用默认的 Anthropic 透传。这两种意思不一样，不能都渲染成空。
        if isinstance(agent.get("transformers"), str):
            raw = agent["transformers"].strip()
            agent["transformers"] = [] if raw.lower() == "none" else [
                t.strip() for t in raw.split(",") if t.strip()
            ]

        if isinstance(agent.get("models"), str):
            # .env 里是逗号分隔的一行，配置要的是列表
            agent["models"] = [m.strip() for m in agent["models"].split(",") if m.strip()]
            if not agent["models"]:
                sys.exit("AGENT_MODELS 填了但拆不出模型名")
            # 换了模型清单又没单独指定角色模型时，别把官方默认那几个 claude 留在这三个字段上
            for field, var in role_fields:
                if not os.environ.get(var, "").strip():
                    agent[field] = agent["models"][0]
        # 后台启动时 zod 会校验「三个角色模型都得在清单里」，不过就是服务起不来。
        # 与其等容器起不来再翻日志，不如在渲染阶段就说清楚是哪个变量填错了。
        for field, var in role_fields:
            if agent.get(field) not in agent.get("models", []):
                sys.exit(
                    f"agent.{field} = {agent.get(field)!r} 不在 agent.models {agent.get('models')} 里，"
                    f"检查 .env 里的 {var} 和 AGENT_MODELS"
                )

    tmp = out_path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        yaml.safe_dump(base, f, allow_unicode=True, sort_keys=False, width=1000)
    os.replace(tmp, out_path)


if __name__ == "__main__":
    main()
