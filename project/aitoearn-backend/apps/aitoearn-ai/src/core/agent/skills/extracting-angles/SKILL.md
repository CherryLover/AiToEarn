---
name: extracting-angles
description: Extracts candidate publishing angles from a project's background material and writes them to angles/. Use when user asks what a project could post about, wants content directions or entry points before writing anything, or asks to brainstorm angles from real material. 提炼发布方向、提炼角度、候选方向、内容方向、切入点、从物料提炼方向、这个项目能发什么。
---

# Angle Extraction

Reads a project's background material and proposes 3-6 candidate publishing angles, writing one file per angle into `angles/`.

An angle is a **hypothesis to be tested**, not a category. Content gets published along it, the numbers come back, and the angle is either deepened or dropped. So an angle has to be specific enough to be proven wrong.

## When to Use

Use this skill when:

- User asks what this project could post about
- User wants candidate directions before any content is generated
- Existing angles are exhausted and fresh ones are needed

**Do NOT use** when:

- User already picked an angle and wants a post written → use `drafting-post`
- User wants to edit or retire an existing angle → that is a web UI action, not a generation task

## Hard Rule: Facts Come Only From `background/`

**Every factual claim in an angle must trace back to a file under `background/`.**

- No invented features, numbers, user quotes, prices, awards, or competitor comparisons
- No "typical for this kind of product" filler, no industry common sense presented as project fact
- If the material does not support an angle that looks promising, **say the material is missing and name exactly what is missing** — do not write the angle anyway
- Returning fewer than 3 angles is a valid outcome. Inventing the 4th is not.

An angle built on a fabricated fact poisons every post later generated from it, and nobody downstream can tell. This rule is not negotiable.

## Workspace

The task is already locked to the project's material directory, so **use relative paths**.

| Path                   | What is in it                                            |
| ---------------------- | -------------------------------------------------------- |
| `CLAUDE.md`            | Project brief: what it is, who it targets, what it wants |
| `background/product/`  | Product intro, feature notes                             |
| `background/website/`  | Site copy, page captures                                 |
| `background/feedback/` | User feedback, reviews, complaints                       |
| `background/legal/`    | Terms, privacy policy                                    |
| `angles/`              | Existing angles, one `.md` per angle                     |

`background/` is source material: **read only, never edit**. Paths outside the project are rejected by the runtime; do not try.

## Workflow

### Step 1: Read the Project Brief

Read `CLAUDE.md`. Note the audience and the goal — an angle that serves neither is off target.

### Step 2: Inventory the Material

`Glob` with pattern `background/**/*` to see what exists.

If nothing is there, report that `background/` is empty, list which subdirectory would help most, and stop. Do not extract angles from `CLAUDE.md` alone.

### Step 3: Read Existing Angles First

`Glob` `angles/*.md` and read every one before proposing anything.

Do not propose an angle that repeats an existing one. If a new idea overlaps, either drop it or narrow it into a genuinely different cut and state in the file what it does differently.

### Step 4: Read the Material

`Read` the files found in Step 2. `background/feedback/` is usually the densest source — real complaints are pain points already written down. Use `Grep` to find words that recur across files; repetition is a signal.

**Record the relative path of every file you actually used.** It goes into the angle file.

### Step 5: Shape 3-6 Angles

Every angle must answer all three questions. Drop any that fails one.

| Question                                    | Too vague                | Specific enough                                |
| ------------------------------------------- | ------------------------ | ---------------------------------------------- |
| **Pain** — what problem does it cut into?   | "users want convenience" | "reviews say export takes four clicks to find" |
| **Hook** — why would anyone stop scrolling? | "introduce our features" | "the one-click export nobody ever found"       |
| **Audience** — who exactly?                 | "everyone"               | "solo designers handing files to clients"      |

Spread the angles apart. Six variations of "our product is good" is one angle, not six.

### Step 6: Write One File Per Angle

Write to `angles/<slug>.md`. Never overwrite an existing angle file — if the slug is taken, pick a different slug.

Every file needs a **one-line `desc`** in its front matter, built from the pain and the hook you just settled in Step 5. It is the only thing the angle list shows, so an angle without it is registered but unreadable — write it as you write the file, not as a fix-up afterwards.

**Slug rules** (same as the project name rules):

- Pattern `^[a-z][a-z0-9-]{1,38}[a-z0-9]$` — 3 to 40 characters, starts with a lowercase letter, only lowercase letters, digits and hyphens, does not end with a hyphen
- No consecutive hyphens (`--`)
- Reserved, never usable: `archived`, `tmp`, `temp`, `system`, `config`, `node_modules`, and anything starting with `_` or `.`
- Descriptive in English, e.g. `export-friction`, `client-handoff`, `first-week-drop-off`

### Step 7: Report

List each angle with slug, name, pain / hook / audience in one line each, and the files it came from. Then name any promising direction you had to drop for lack of material, and which material would unblock it.

## Angle File Format

Front matter carries the metadata the server stores; the body is the writing brief that `drafting-post` will follow.

```markdown
---
slug: export-friction
name: 导出卡点
desc: 切「导出功能藏得太深」这个反复出现的抱怨，噱头是没人找得到的一键导出
source: ai
parent: null
status: candidate
sourceAssetPaths:
  - background/feedback/app-store-reviews.md
  - background/product/features.md
promptSnapshot: extracting-angles / 从 background 提炼候选方向
---

## 切什么痛点

用户反馈里反复出现「导出要点四下才找得到」，……（引用得有出处，写清是哪份物料里的说法。）

## 噱头

……（一句话说明为什么有人会停下来看。）

## 面向谁

……（具体到人群，不要写「所有人」。）

## 怎么写

- 语气：……
- 结构：……
- 每篇必须落到的一件事：……

## 避开什么

- ……（哪些说法没有物料支撑，不许写。）
```

### Front Matter Fields

| Field              | Required | Value                                                          |
| ------------------ | -------- | -------------------------------------------------------------- |
| `slug`             | yes      | Matches the file name, no `.md`                                |
| `name`             | yes      | Display name, Chinese is fine                                  |
| `desc`             | yes      | **One line: what pain this angle cuts into, and what the hook is** |
| `source`           | yes      | `ai` when this skill wrote it                                  |
| `parent`           | yes      | `null`, unless deriving from an existing angle — then its slug |
| `status`           | yes      | `candidate` for everything this skill produces                 |
| `sourceAssetPaths` | yes      | Relative paths of the material actually used, one per line     |
| `promptSnapshot`   | yes      | One line saying how this angle was produced                    |

These are exactly the fields the server parses when it registers the file. Two of them carry weight beyond the file itself:

**`desc` is what the angle list in the web UI shows.** Leave it out and the card is a bare name: the list becomes a column of labels with no way to tell what any angle actually cuts into, and choosing one means opening every file. Write it as one concrete line — the pain and the hook — not a verdict like「这个方向很有潜力」.

**`sourceAssetPaths` is not decoration** — the server reads it back to record which material fed which angle. An empty list means the angle came from nothing, which the Hard Rule forbids.

The server also accepts `sourceAssets` for `sourceAssetPaths` and `prompt` for `promptSnapshot` — those are the names it writes itself. Either spelling is read correctly; the names in the table above are the ones to write.

## Examples

### Example 1: Extract From Scratch

**User request**: "看看这个项目能从哪些角度发内容"

```
1. Read CLAUDE.md
2. Glob "background/**/*"        → 7 files
3. Glob "angles/*.md"            → empty, nothing to avoid
4. Read the 7 files, Grep for recurring complaints
5. Shape 4 angles, each with pain / hook / audience
6. Write angles/export-friction.md, angles/client-handoff.md,
   angles/first-week-drop-off.md, angles/pricing-doubt.md
7. Report the 4 angles and their source files
```

### Example 2: Existing Angles Present

```
1. Read CLAUDE.md
2. Glob "angles/*.md"            → 3 existing angles, read all
3. Glob "background/**/*", read what the existing angles did not use
4. Propose 3 NEW angles; the "pricing" idea overlaps an existing angle,
   so narrow it to "yearly-vs-monthly doubt" or drop it
5. Write only the new files
```

### Example 3: Material Too Thin

```
1. Read CLAUDE.md
2. Glob "background/**/*"        → only background/legal/terms.md
3. Report: only the terms of service is present; no product notes and
   no user feedback, so no angle can be grounded. Ask for material in
   background/product/ and background/feedback/. Write nothing.
```

## Important Notes

- Write angle files one at a time and confirm each write before the next
- Never modify anything under `background/`
- Never overwrite an existing `angles/*.md`; a taken slug means pick another
- Angles written here are always `status: candidate` — promoting to testing / effective is a human decision made in the web UI
- Deriving a child angle: set `source: derived` and `parent: <parent slug>`, and say in the body what it narrows down compared to the parent
- Reply in the user's language; file content follows the project's own language
