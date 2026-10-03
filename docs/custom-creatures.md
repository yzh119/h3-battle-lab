# 自定义兵种格式（v1）

侧栏「自定义兵种」可以导入版本 1 的 JSON，并把兵种加入阵容。连接原生引擎后，独立转换器把整个包验证并转换成标准 VCMI mod，再启动新的引擎会话；初始化成功才切换，失败保留原会话。原版参考模式与自定义模式在界面和引擎目录中分别标记。战斗机制全部由编译后的 VCMI 执行，TypeScript 只验证输入、显示目录和播放事件。

没有原生引擎时仍可验证格式，暂不能加入对战。公开仓库不含游戏资源和模型；导入的兵种没有 GLB 时使用示意模型。

可验证 [完整示例](../examples/custom-creatures.json)，编辑器可关联 [JSON Schema](../schemas/creature-pack.schema.json)。GUI 校验入口为 `parseCreaturePack()`；原生转换器为 `scripts/native/custom-pack.py`。原版兵种的战斗数值只从引擎读取，前端不再维护基础数值表。

```json
{
  "version": 1,
  "creatures": [{
    "id": "custom-guard",
    "label": "自定义卫士",
    "faction": "自定义城堡",
    "ruleset": "custom",
    "stats": {
      "health": 35, "attack": 10, "defense": 12,
      "minDamage": 6, "maxDamage": 9, "speed": 5
    },
    "mechanisms": [{ "type": "additionalAttacks", "count": 1 }]
  }]
}
```

## 字段

| 字段 | 含义与限制 |
| --- | --- |
| `version` | 固定为 `1`；将来不兼容的格式会升级版本 |
| `creatures` | 1–256 个兵种；导入文件最多 1 MB |
| `id` | 小写字母开头，后接小写字母、数字或 `-`，最多 64 字符；必须唯一 |
| `label`, `faction` | 名称和选择器分组，1–80 字符，不能全为空白 |
| `ruleset` | 导入兵种必须是 `custom`；内置原版 ID 禁止覆盖，避免自定义平衡污染原版模式 |
| `stats.health` | 每只生命，1–100,000 |
| `stats.attack`, `stats.defense` | 基础攻防，0–1,000 |
| `stats.minDamage`, `stats.maxDamage` | 每只伤害区间，1–100,000；下限不能超过上限 |
| `stats.speed` | 行动顺序和每回合移动距离，1–50 |
| `stats.aiValue` | 可选原生 AI 估值，1–1,000,000；默认 100，原样传给 VCMI，不由界面推导 |
| `mechanisms` | 明确支持的机制数组；没有特性时填 `[]`；同种机制最多出现一次 |

所有数值为整数。未知字段、未知机制、重复 ID、重复机制与非法数值均报出字段路径。转换前验证整个包；任一项失败则整个包不加入引擎目录。后续导入追加到当前页面的自定义包，重复 ID 会报错。重置和重新连接保留已导入定义；重新加载页面回到原版参考模式。修改定义后可重新加载页面再导入，或采用新 ID。

## 原生机制映射

| 配置 | 战斗语义 |
| --- | --- |
| `{ "type": "flying" }` | 按六角格距离限制飞行；允许跨越障碍和队伍，落点必须空且在棋盘内 |
| `{ "type": "additionalAttacks", "count": 1 }` | 正常攻击外追加 1–4 击；可选 `mode` 为 `melee`（默认）、`ranged` 或 `both`，只在指定攻击方式生效；每击重新按存活数量算伤害；第一击后可发生反击；任一队阵亡即停止 |
| `{ "type": "regeneration", "health": 10 }` | 每回合首次轮到该队时，按 VCMI 当前实现最多恢复这些 HP，只治疗受伤的末只，不能复活或恢复死队；1–100,000 |
| `{ "type": "retaliations", "count": 2 }` | 每回合最多反击这些次；0–100；省略时为 1；追加攻击不会再次触发反击 |
| `{ "type": "blocksRetaliation" }` | 自己主动攻击时阻止敌人反击；不消耗敌人的反击额度 |

转换器映射到 VCMI 的 `FLYING`、`ADDITIONAL_ATTACK`、`HP_REGENERATION`、`ADDITIONAL_RETALIATION`／`NO_RETALIATION`、`BLOCKS_RETALIATION`、`SHOOTER`、`UNDEAD` 和 `SPELL_LIKE_ATTACK` 等 bonus。攻击方式用原生 `effectRange` 限定；死亡之云使用原生 `core:deathCloud`。不会给原版兵种添加或覆盖 bonus。

恢复时机目前遵循 VCMI 的首次行动前处理，不能据此声称与原版 H3 完全一致。新增机制必须在引擎或引擎脚本实现，并同步更新转换器、校验和 Schema；未知 `type` 会拒绝整个包。`faction` 是选择器分组名称，当前所有导入兵种的原生阵营都是 `core:neutral`，不会自动创建新城镇或继承墓园／城堡阵营加成。

远程扩展也使用版本 1，已有兵种包无需修改。`additionalAttacks.mode: "ranged"` 与 `deathCloud` 必须同时配置 `shooter`。

| 配置 | 战斗语义 |
| --- | --- |
| `{ "type": "shooter", "shots": 12 }` | 战斗开始装填 1–1,000 发；每次射击消耗一发，回合不补充；任一相邻敌人封锁射击，友军不封锁；超出 10 格伤害减半，近战伤害减半 |
| `{ "type": "shooter", "shots": 24, "noMeleePenalty": true }` | 取消近战减半；可选 `noDistancePenalty: true` 取消距离减半；两个参数必须是布尔值 |
| `{ "type": "undead" }` | 原生亡灵标签，参与死亡之云溅射免疫、士气和魔法规则 |
| `{ "type": "deathCloud" }` | 射击主目标及其周围一圈中的存活非亡灵队伍，包括友军；主目标即使是亡灵也会受伤；各目标独立计算伤害和伤亡；近战不触发 |

射击不触发反击；弹药不足或主目标已被第一发击杀时取消后续射击。神射手的双射是 `shooter` 与 `additionalAttacks.mode: "ranged"` 的组合，并不会让其近战连击。尸巫是 `undead`、`shooter`、`deathCloud` 的组合。侧栏 **射手强制近战** 可指定近战；关闭时有弹药且未被封锁的射手默认射击。

## 配套模型

兵种数据与美术清单按相同 `id` 关联。GLB 清单格式，在忽略目录 `public/local-assets/manifest.json` 中添加：

```json
{
  "units": {
    "custom-guard": {
      "label": "自定义卫士",
      "faction": "自定义城堡",
      "url": "/local-assets/custom-guard.glb",
      "height": 2.35
    }
  }
}
```

模型支持 `idle`、`walk`、`attack`、`hit`、`death` 动画；射手可再提供 `shoot` 动画，缺少时回退到攻击动画。缺少美术使用程序生成替身。初始载入失败保留替身；替换已有队伍时模型失败保留原队伍。页面的本地 GLB 导入只替换选中队伍外观，战斗规则仍由 VCMI 计算。

带私有路径的配置、GLB、贴图和 Blender 文件只放在忽略目录；公开的示例和 Schema 都只含规则数据。自定义兵种在目录中标记，不能据此宣称原版 H3 平衡。


## 独立 mod 与资源目录

需要 Python 3。GUI 导入只在没有战斗和待处理请求时执行，标准 mod 及候选会话位于忽略目录 `.local/native-sessions/`。独立资源目录只引用预先准备的原版数据和必需 `vcmi` 模块，额外启用本仓库生成的 `battle-lab-custom`；不会读取本机其他 mod 或改动 VCMI 源码。

也可以单独生成一个新资源目录：

```sh
python3 scripts/native/custom-pack.py \
  --base .local/base-profile --out .local/custom-profile \
  --pack examples/custom-creatures.json
BATTLE_LAB_PROFILE="$PWD/.local/custom-profile" .local/backend/battle-backend
```

目标目录必须不存在。生成的 `data/Mods/battle-lab-custom/` 是标准 VCMI mod，使用独立命名空间；GUI 用相同作者 ID 关联 GLB。原生图形字段暂引用原版枪兵动画作为 headless 加载占位，三维界面仍使用自己的模型或示意模型。导出的 mod 数据不包含动画文件、贴图或完整游戏资源。

验证包括原生数据、飞行、近战追加攻击与禁反击、双射、死亡之云友军溅射与亡灵免疫、恢复和反击额度，以及浏览器导入、原生对战、AI 行动、重置、拒绝重复导入和重新连接。
