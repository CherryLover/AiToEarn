---
name: drafting-post
description: Writes one publish-ready post draft for a project, following a chosen angle and an optional target platform, and saves it under drafts/ with its lineage. Use when user wants to generate content for a project, write a post along an angle, produce a Xiaohongshu note, or turn material into a draft. 生成内容、按方向生成、写文案、出稿、生成草稿、写小红书笔记、写帖子、生成待发内容。
---

# Post Drafting

Turns a project's real material into one ready-to-publish draft, following a chosen angle and — when a platform is named — that platform's own limits, looked up from the server at generation time.

Output goes to `drafts/<yyyy-MM-dd>-<platform>-<angle-slug>/`, containing the post itself and a lineage record of what produced it.

## When to Use

Use this skill when:

- User wants content generated for a project along a specific angle
- User names a platform (Xiaohongshu / Douyin / ...) and asks for a post
- A draft needs to be regenerated with a different angle or platform

**Do NOT use** when:

- No angle exists yet → run `extracting-angles` first
- User wants media generated, not written content → use `generating-images` / `generating-videos`

## Inputs

| Input      | Required | Notes                                                                           |
| ---------- | -------- | ------------------------------------------------------------------------------- |
| project    | yes      | Already set — the task works inside the project directory                       |
| angle slug | yes      | An existing `angles/<slug>.md`. If not given, list the available angles and ask |
| platform   | **no**   | Omitted → write platform-neutral content. There is no default platform         |

## Hard Rule: Facts Come Only From `background/`

**Every factual claim in the draft must trace back to a file under `background/`.**

- No invented features, numbers, prices, user quotes, testimonials, awards, or comparisons
- No borrowed industry common sense presented as a fact about this project
- Missing a fact the post needs? **Say what is missing and where it would go** — write the post around the gap, or stop and ask. Never fill it in.
- Personal-experience framing ("我用了三个月……") is only allowed when the material actually contains that experience

Tone, structure and phrasing are yours to invent. Facts are not.

## Workspace

The task is already locked to the project's material directory, so **use relative paths**.

| Path          | What is in it                                          |
| ------------- | ------------------------------------------------------ |
| `CLAUDE.md`   | Project brief: what it is, who it targets, the goal    |
| `angles/`     | Writing briefs, one `.md` per angle                    |
| `background/` | Source material — **read only, never edit**            |
| `media/`      | Images plus a card file per image, holding its OSS URL |
| `drafts/`     | Where this skill writes                                |

## Workflow

### Step 1: Read the Project Brief

Read `CLAUDE.md`: audience, goal, anything the project says to avoid.

### Step 2: Read the Angle

Read `angles/<slug>.md`. It is the writing brief — pain point, hook, audience, tone, what to avoid. Follow it; do not quietly drift to a nicer-sounding angle.

Note its `sourceAssetPaths` front matter: that is the material the angle was built on, and the first material to read.

### Step 3: Feed In What Already Worked

**From the second generation onward, past performance is an input, not an afterthought.** Repeating an angle that already flopped wastes a publishing slot; the point of this whole loop is that each round is informed by the last.

Look for performance data in this order, and use whatever is present:

1. **A performance block in the task prompt**, delimited by `<angle-performance>` … `</angle-performance>`. This is the channel the server uses when it has fresh numbers.
2. **`performance.md` at the project root** — a cross-angle summary of which angles performed and on what metric.
3. **A `## 战绩` section inside `angles/<slug>.md`** — this angle's own track record.

How to use it:

- The angle's own past posts did well → keep what worked (hook shape, opening line, structure) and vary the rest
- The angle's past posts did badly → say so in the report, and ask whether to continue or switch angle before spending a generation on it
- A sibling angle did well on a specific hook → borrow the hook **shape**, never its facts
- Record what you used in `meta.json` → `performanceInputs`

**None of the three sources present is the normal case today** — performance collection is not wired up yet. Then: skip this step silently, and write `"performanceInputs": []` in `meta.json`. Do not ask the user for numbers, and do not guess at past performance.

### Step 4: Read the Material

`Read` the files in the angle's `sourceAssetPaths`. `Glob` / `Grep` `background/` for anything else the post needs — concrete details, real wording from `background/feedback/`, exact feature names from `background/product/`.

**Track the relative path of every file you actually used.** It goes into `meta.json`.

### Step 5: Pick Images From `media/`

`Glob` `media/*` to see what exists. Every image has a card file next to it named `<image file name>.md` — for example `media/home-screen.png` → `media/home-screen.png.md`.

Read the card and take the `oss:` field from its front matter. **That OSS URL is what goes into the draft** — the publishing side downloads from it, so a local path is useless there.

- `oss:` empty → the upload failed; do not use that image, and say so in the report
- No suitable image → leave `images` empty and say which image would help
- Never invent an image URL, and never point at a file that is not in `media/`

### Step 6: Look Up the Platform, Then Write

**If a platform was given, fetch its limits first** — see [Platform Limits](#platform-limits-look-them-up-never-hard-code-them) below. Writing to a remembered number is guessing, and this skill does not guess.

Get the date from the `getCurrentTime` tool — never guess it. Take the date part of the ISO timestamp.

Create `drafts/<yyyy-MM-dd>-<platform>-<angle-slug>/` and write two files into it. If that directory already exists, append `-2`, `-3` … rather than overwriting a previous draft.

The platform segment of the directory name is the platform code (`xhs`, `douyin`, `wxSph` …), not the display name — or `general` when no platform was given.

### Step 7: Check Against the Limits You Looked Up

No platform given → there is nothing to check. Skip this step.

Otherwise re-read what you wrote and count it against the metadata from Step 6 — not against a number you remember. Lengths count **characters, not bytes** — a Chinese character is one.

- Over a limit the metadata actually defines → a broken draft, not a rough edge. Fix it and rewrite the file
- A limit the metadata does not define → nothing to enforce; do not invent a cap to check against

### Step 8: Report

Give the draft directory path, the title, the body, the topics, the images used, and the material the facts came from. Then name anything you wanted to say but had no material for.

## Platform Limits: Look Them Up, Never Hard-Code Them

**This document deliberately contains no platform limits.** The numbers live in the server, and the only correct way to get them is to ask for them at generation time.

### No Platform Given

Platform is an optional input, and **there is no default**. Write platform-neutral content: a title line that works as a headline, a body that stands on its own, and topics if the angle calls for them.

**Do not trim to some platform's limits "just in case".** Picking a platform the user never named, and cutting the draft to its caps, silently throws away material on an assumption nobody made. Write what the angle and the material justify.

In that case: `platform` is an empty string in both output files, and the directory's platform segment is `general`. Say in the report that the draft is platform-neutral, and offer to fit it to a platform once one is chosen.

### Platform Given

Call `getChannelPlatform` with the platform code to get that platform's metadata — or `listChannelPlatforms` when you need to see what exists. Read the limits off the response:

| What you need       | Where it is in the response                                          |
| ------------------- | -------------------------------------------------------------------- |
| Title length        | `contentLimits.maxTitleLength`                                       |
| Body length         | `contentLimits.maxBodyLength`                                        |
| Title + body budget | `contentLimits.maxTotalTextLength`                                   |
| Image count         | `contentLimits.maxImages`                                            |
| Content modes       | `contentLimits.modes` — see the warning below                        |
| Topics allowed      | `topic.supported`                                                    |
| Topic count         | `topic.maxCount`                                                     |
| Topic total length  | `topic.maxTotalLength`                                               |

Platform codes are the server's own account-type values (`xhs`, `douyin`, `wxSph`, `wxGzh` …). Unsure of one? Call `listChannelPlatforms` and read the code off the response rather than inventing it.

**The values inside `contentLimits.modes` are not self-describing** — they are internal codes, and the one meaning "image-text" is not spelled the way you would guess. Do not test for a spelling you assumed. Compare the platform's `modes` against those of a platform you know publishes image-text posts, or read the mode codes off `listChannelPlatforms` first. A platform whose modes are video-only cannot take an image-text post: say so rather than producing a draft that cannot be published.

### A Field That Is Not There Means "No Known Limit"

**If the metadata does not define a limit, that limit does not exist as far as this skill is concerned.** Report it as "no known limit" and move on.

Never substitute a number from memory, from a sibling platform, or from how the platform's own app appears to behave. A made-up cap quietly truncates a good draft, and nothing downstream can tell an invented number from a real one.

Two cases that look like missing data but are not:

- `maxTitleLength` absent or `0` → that platform has no separate title field. Put everything in the body and leave `title` empty
- `topic.supported: false` → no topics at all. That is a real limit, not a missing one

### Why There Are No Numbers Here

The limits are defined per platform under `apps/aitoearn-server/src/core/channels/platforms/<platform>/<platform>.constants.ts`, and the two tools above serve exactly those values.

A copy pasted into this file would be a second source of truth that nobody updates when the server changes — stale, confidently wrong, and invisible. **So do not add a limits table to this skill, and do not "helpfully" fill one back in.** Look them up every run.

## Output Files

### `content.md`

Front matter carries the publishable fields; the body is the post exactly as it should go out.

```markdown
---
title: 导出藏得太深，四步变一步
platform: xhs
angle: export-friction
topics:
  - 效率工具
  - 设计师日常
images:
  - https://<oss-domain>/<key>
---

（正文原样写在这里，发布时直接取用。不要在正文里再重复一遍标题。）

#效率工具 #设计师日常
```

| Field      | Notes                                                               |
| ---------- | ------------------------------------------------------------------- |
| `title`    | Within the looked-up limit; empty string when the platform has no title field |
| `platform` | The platform code; empty string when the draft is platform-neutral  |
| `angle`    | The angle slug this followed                                        |
| `topics`   | Without the leading `#`; also written inline at the end of the body |
| `images`   | OSS URLs taken from the `media/` card files, in display order       |

### `meta.json`

The lineage record. Everything downstream — attribution, "why did this post exist" — reads it.

```json
{
  "projectName": "fortyweeks",
  "angleSlug": "export-friction",
  "platform": "xhs",
  "sourceAssetPaths": [
    "background/feedback/app-store-reviews.md",
    "background/product/features.md"
  ],
  "mediaRefs": [
    { "file": "media/home-screen.png", "oss": "https://<oss-domain>/<key>" }
  ],
  "promptSnapshot": "按方向 export-friction 生成一条小红书图文，切导出卡点",
  "performanceInputs": [],
  "model": "claude-opus-4-6",
  "createdAt": "2026-09-18T05:00:00Z"
}
```

| Field               | Notes                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| `projectName`       | The project's English name, same as the directory name                         |
| `angleSlug`         | Must match an existing `angles/<slug>.md`                                      |
| `platform`          | Platform code; empty string when no platform was given                         |
| `sourceAssetPaths`  | Material actually read and used. **Empty here means the Hard Rule was broken** |
| `mediaRefs`         | Images used, local path plus OSS URL                                           |
| `promptSnapshot`    | What was asked for, in one line                                                |
| `performanceInputs` | What past-performance data was fed in; `[]` when none was available            |
| `model`             | The model that wrote it; empty string if genuinely unknown                     |
| `createdAt`         | ISO 8601, from `getCurrentTime`                                                |

## Examples

### Example 1: Xiaohongshu Post Along an Angle

**User request**: "按 export-friction 这个方向写一条小红书"

```
1. Read CLAUDE.md
2. Read angles/export-friction.md
3. No <angle-performance> block, no performance.md → skip, performanceInputs: []
4. Read background/feedback/app-store-reviews.md, background/product/features.md
5. Glob media/* → read media/home-screen.png.md, take its oss URL
6. getChannelPlatform "xhs" → read its title / body / image / topic limits
   off the response; do not assume any of them
7. getCurrentTime → 2026-09-18
8. Write drafts/2026-09-18-xhs-export-friction/content.md + meta.json
9. Count title, body, topics and images against what step 6 returned
10. Report path, title, body, topics, images, source material
```

### Example 2: Angle Not Given

```
1. Glob angles/*.md → export-friction, client-handoff, pricing-doubt
2. List them with their pain point in one line each, ask which to use
3. Proceed once the user picks
```

### Example 3: Material Does Not Cover the Claim

```
1..4 as above; the angle wants "省下 80% 时间", nothing in background/ says that
5. Write the post without the number, keeping the concrete complaint the
   reviews DO contain
6. Report: the "省下 80%" claim has no material behind it; a measurement or a
   user quote in background/product/ would let it be used next time
```

### Example 4: Second Generation With Performance Data

```
1-2. Read CLAUDE.md and the angle
3. <angle-performance> block present: export-friction's last post led on
   collects; pricing-doubt flopped
4. Keep the "problem first, product second" opening that worked, vary the rest
5-7. Write as usual, with
   performanceInputs: ["angle-performance: export-friction 上一条收藏领先"]
8. Report which past result shaped the choice
```

### Example 5: No Platform Given

**User request**: "按 export-friction 写一条内容"

```
1-5. As in Example 1
6. No platform named → assume none, look nothing up, trim nothing
7. getCurrentTime → 2026-09-18
8. Write drafts/2026-09-18-general-export-friction/, with platform: ""
   in the content.md front matter and "platform": "" in meta.json
9. Skip the limit check — there are no limits to check against
10. Report that the draft is platform-neutral, and offer to fit it to a
    platform's limits once the user names one
```

### Example 6: Platform Defines No Topic Limit

```
1-5. As in Example 1, platform wxSph
6. getChannelPlatform "wxSph" → topic.supported is true, but neither
   maxCount nor maxTotalLength is defined
7. Write the topics the angle justifies; do NOT borrow another platform's
   count as a cap
8. Report: title and body checked against their defined limits; topic count
   has no known limit on this platform
```

## Important Notes

- One draft per run. Multiple platforms means multiple directories, written one at a time — and one metadata lookup per platform
- Never write a platform limit into this file, into a draft, or into a report as if it were known. Look it up, or say it is not defined
- Never edit anything under `background/`, and never overwrite an existing draft directory
- `content.md` is the post as it will go out — no notes to self, no "option A / option B" inside it
- The publish snapshot is taken from `content.md` at publish time, so what is in the file is what gets sent
- Write in the project's own language; reply to the user in the user's language
