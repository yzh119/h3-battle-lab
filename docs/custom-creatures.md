# 自定义兵种格式（v1）

当前格式是兵种与机制的通用编写格式。侧栏只做验证和注册，**通过验证的自定义兵种暂不能加入对战**。自动加载 `creatures.json` 已暂停。战斗全部由编译后的 VCMI 执行；后续转换器把这些定义转成 VCMI 兵种、bonus 或脚本数据，不能在 TypeScript 中解释机制。详见 [引擎接入方案](vcmi-adapter.md)。

可验证 [完整示例](../examples/custom-creatures.json)，编辑器可关联 [JSON Schema](../schemas/creature-pack.schema.json)。入口为 `parseCreaturePack()` 与 `registerCreaturePack()`；原版兵种的战斗数值只从引擎读取，前端不再维护基础数值表。

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
| `mechanisms` | 明确支持的机制数组；没有特性时填 `[]`；同种机制最多出现一次 |

所有数值为整数。未知字段、未知机制、重复 ID、重复机制与非法数值均报出字段路径。注册前验证整个包；任一项失败则整个包不加入目录。重复导入已注册 ID 会报错；修改文件后重新加载页面或采用新 ID。

## 格式中的机制（引擎转换待实现）

| 配置 | 战斗语义 |
| --- | --- |
| `{ "type": "flying" }` | 按六角格距离限制飞行；允许跨越障碍和队伍，落点必须空且在棋盘内 |
| `{ "type": "additionalAttacks", "count": 1 }` | 正常攻击外追加 1–4 击；可选 `mode` 为 `melee`（默认）、`ranged` 或 `both`，只在指定攻击方式生效；每击重新按存活数量算伤害；第一击后可发生反击；任一队阵亡即停止 |
| `{ "type": "regeneration", "health": 10 }` | 每回合开始最多恢复这些 HP，只治疗受伤的末只，不能复活或恢复死队；1–100,000 |
| `{ "type": "retaliations", "count": 2 }` | 每回合最多反击这些次；0–100；省略时为 1；追加攻击不会再次触发反击 |
| `{ "type": "blocksRetaliation" }` | 自己主动攻击时阻止敌人反击；不消耗敌人的反击额度 |

这些配置目前仅有字段校验，尚未建立引擎映射。表内语义为编写意图，最终需与原版目标及 VCMI 可表达的机制核对，特别是恢复时机和防御取整。新增机制必须在引擎或引擎脚本实现，并同步更新转换器、校验和 Schema。不能仅靠添加未知 `type` 启用新行为。

远程扩展也使用版本 1，已有兵种包无需修改。`additionalAttacks.mode: "ranged"` 与 `deathCloud` 必须同时配置 `shooter`。

| 配置 | 战斗语义 |
| --- | --- |
| `{ "type": "shooter", "shots": 12 }` | 战斗开始装填 1–1,000 发；每次射击消耗一发，回合不补充；任一相邻敌人封锁射击，友军不封锁；超出 10 格伤害减半，近战伤害减半 |
| `{ "type": "shooter", "shots": 24, "noMeleePenalty": true }` | 取消近战减半；可选 `noDistancePenalty: true` 取消距离减半；两个参数必须是布尔值 |
| `{ "type": "undead" }` | 亡灵标签；当前用于死亡之云溅射免疫，今后也将用于亡灵的士气／魔法规则 |
| `{ "type": "deathCloud" }` | 射击主目标及其周围一圈中的存活非亡灵队伍，包括友军；主目标即使是亡灵也会受伤；各目标独立计算伤害和伤亡；近战不触发 |

射击不触发反击；弹药不足或主目标已被第一发击杀时取消后续射击。神射手的双射是 `shooter` 与 `additionalAttacks.mode: "ranged"` 的组合，并不会让其近战连击。尸巫是 `undead`、`shooter`、`deathCloud` 的组合。侧栏 **射手强制近战** 可指定近战；关闭时有弹药且未被封锁的射手默认射击。

## 配套模型

计划中的引擎导入完成后，兵种数据与美术清单按相同 `id` 关联。GLB 清单格式，在忽略目录 `public/local-assets/manifest.json` 中添加：

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
