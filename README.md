# stan-workout

My personalized workout app. [https://5tan.github.io/stan-workout](https://5tan.github.io/stan-workout)

## Workout yaml format

Example:
```yaml
name: Example Workout          # required; shown on menu card
description: "Optional desc."

plan:
  # Duration-based step
  - step: { exercise_id: wrists-warm-up, duration_s: 20 }

  # With label (shown as "Shoulder Roll (Direction 1)") and optional image_flip
  - step: { exercise_id: shoulder-roll, label: Direction 1, duration_s: 15 }
  - step: { exercise_id: hip-circles-standing, label: Left, image_flip: true, duration_s: 15 }

  # Reps-based step — rep_duration_s rounded to nearest 0.5 s
  # sequence: prep countdown → "Go!" → 1s initial → reps → final rep period + long beep
  - step: { exercise_id: dumbbell-bench-press, reps: { prep_s: 5, reps_num: 10, rep_duration_s: 3.5 }, weight: 7.5kg }

  # Rest
  - step: { exercise_id: rest, duration_s: 60 }

  # Reusable set via YAML anchor/alias
  - &my-set
    - step: { exercise_id: push-ups, reps: { prep_s: 5, reps_num: 8, rep_duration_s: 3 } }
    - step: { exercise_id: rest, duration_s: 30 }
  - step: { exercise_id: rest, duration_s: 90 }
  - *my-set

  # Embed another workout file
  - include: warm-up-2.yaml
```

## Reps-based step timing

### Formula

```
total_duration_s = prep_s + INITIAL_REP_PERIOD_S + (reps_num + 1) × rep_duration_s
```

### Sequence

| Phase              | Duration                    | Event                                                                |
| ------------------ | --------------------------- | -------------------------------------------------------------------- |
| Prep countdown     | `prep_s`                    | After `GET_READY_SPEAK_DELAY_MS`: speak **"get ready"**; then silent |
| Transition         | t = `prep_s`                | Speak **"Go!"**                                                      |
| Initial rep period | `INITIAL_REP_PERIOD_S`      | No announcement                                                      |
| Rep periods        | `reps_num × rep_duration_s` | Speak rep number at the end of each period ("1", "2", … `reps_num`)  |
| Final rep period   | `1 × rep_duration_s`        | Silent; **Long beep** at end                                         |

### Example

```yaml
step: { exercise_id: dumbbell-bench-press, reps: { prep_s: 5, reps_num: 3, rep_duration_s: 2 }, weight: 7.5kg }
```

`rep_duration_s: 2` → already a multiple of 0.5, no rounding

| Phase                                       | Duration | Cumulative |
| ------------------------------------------- | -------- | ---------- |
| Prep countdown (`prep_s`)                   | 5 s      | 5 s        |
| Initial rep period (`INITIAL_REP_PERIOD_S`) | 1 s      | 6 s        |
| 3 rep periods (`3 × 2 s`)                   | 6 s      | 12 s       |
| Final rep period (`1 × 2 s`)                | 2 s      | 14 s       |

**Total: 14 s** (`= 5 + 1 + (3 + 1) × 2`)

## Workout design principles

### Strength Training

Focused on building **maximum force output** by training the neuromuscular system to recruit muscle fibres more efficiently.

- **Reps:** ~1–5 per set, to muscular failure
- **Load:** Heavy — 85–100% of 1RM
- **Sets:** 3–5 per exercise
- **Rest:** Long — 3–5 minutes between sets
- **Tempo:** Controlled; explosive on the concentric phase

**Key characteristics:**

| Feature       | Detail                         |
| ------------- | ------------------------------ |
| **Goal**      | Maximal force / neural drive   |
| **Reps**      | 1–5                            |
| **Load**      | 85–100% of 1RM                 |
| **Rest**      | 3–5 min                        |
| **Frequency** | 2–4x per week per muscle group |

**Benefits:**
- Increases maximal strength and power output
- Improves neuromuscular efficiency
- Supports bone density
- Enhances performance in compound lifts (squat, deadlift, bench, etc.)

**Things to keep in mind:**
- Form is critical — heavy loads amplify injury risk
- Requires longer warm-up sets before working sets
- CNS fatigue accumulates — deload weeks are important
- Not ideal for beginners without a solid technique foundation

---

### Hypertrophy Training

Focused on **increasing muscle size** by causing sufficient mechanical tension and metabolic stress to stimulate muscle protein synthesis.

- **Reps:** 10–15 per set, leaving ~2–3 reps in reserve (RIR)
- **Load:** Moderate — 60–80% of 1RM
- **Sets:** 3–4 per exercise
- **Rest:** Moderate — 60–90 seconds between sets
- **Tempo:** Controlled; emphasise the eccentric (lowering) phase

**Key characteristics:**

| Feature       | Detail                         |
| ------------- | ------------------------------ |
| **Goal**      | Muscle size / volume           |
| **Reps**      | 10–15                          |
| **Load**      | 60–80% of 1RM                  |
| **Rest**      | 60–90 s                        |
| **Frequency** | 2–3x per week per muscle group |

**Benefits:**
- Increases muscle cross-sectional area
- Improves body composition
- Boosts metabolism (more muscle = more calories burned at rest)
- Reduces injury risk by strengthening tendons and connective tissue

**Things to keep in mind:**
- Progressive overload is essential — gradually increase weight or reps over time
- Volume matters — total weekly sets per muscle group drive growth
- Adequate daily protein intake required (≥1.6 g/kg body weight per day)
- Muscles grow during recovery, not during training — sleep and rest days are key

**Strength vs. Hypertrophy:**

|             | Strength    | Hypertrophy |
| ----------- | ----------- | ----------- |
| **Goal**    | Max force   | Muscle size |
| **Reps**    | 1–5         | 10–15       |
| **Load**    | 85–100% 1RM | 60–80% 1RM  |
| **Rest**    | 3–5 min     | 60–90 s     |
| **Volume**  | Lower       | Higher      |
| **Fatigue** | CNS-heavy   | Metabolic   |

---

### HIIT (High-Intensity Interval Training)

HIIT alternates between **short bursts of intense activity** and **periods of rest or low-intensity recovery**.

- **Work Phase** → Push to near-maximum effort (80–95% of max heart rate)
- **Rest Phase** → Recover with light activity or complete rest
- **Repeat** → Cycle through multiple rounds

**Key characteristics:**

| Feature        | Detail                                     |
| -------------- | ------------------------------------------ |
| **Duration**   | Typically 15–30 minutes per session        |
| **Intensity**  | Very high during work intervals            |
| **Rest Ratio** | Work-to-rest ratio varies (e.g., 1:1, 1:2) |
| **Frequency**  | 2–4 times per week recommended             |

**Benefits:**
- Burns more calories in less time vs. steady-state cardio
- Boosts metabolism via afterburn effect (EPOC)
- Improves cardiovascular health and VO₂ max
- Preserves muscle mass better than long-duration cardio
- No equipment needed — can be done anywhere

**Things to keep in mind:**
- Requires a base level of fitness
- Risk of injury if form breaks down due to fatigue
- Requires adequate recovery — avoid doing HIIT every day
- Not recommended for people with certain heart conditions

**HIIT vs. Steady-State Cardio:**

|                     | HIIT                  | Steady-State Cardio    |
| ------------------- | --------------------- | ---------------------- |
| **Time**            | Short (15–30 min)     | Long (45–60+ min)      |
| **Calorie Burn**    | High (during & after) | Moderate (during only) |
| **Fat Loss**        | Very effective        | Effective              |
| **Recovery Needed** | More                  | Less                   |


## Diet

### Protein

Protein is the key macronutrient for muscle repair and growth. Without sufficient intake, training adaptation is significantly blunted.

- **Minimum:** 1.6 g per kg of body weight per day
- **Optimal range:** 1.6–2.2 g/kg/day (higher end during a cut or heavy training blocks)
- **Timing:** Spread evenly across 3–4 meals for maximum muscle protein synthesis

**Protein content of common foods:**

| Source                  | Protein per 100g |
| ----------------------- | ---------------- |
| Chicken breast (cooked) | ~31g             |
| Beef, lean (cooked)     | ~26g             |
| Salmon (cooked)         | ~25g             |
| Tuna (canned)           | ~25g             |
| Eggs                    | ~13g (~6g/egg)   |
| Greek yogurt            | ~10g             |
| Cottage cheese          | ~11g             |
| Lentils (cooked)        | ~9g              |

**Example: 60 kg → 96g protein/day**

| Food           | Amount | Protein  |
| -------------- | ------ | -------- |
| Chicken breast | 150g   | ~47g     |
| Eggs           | 2      | ~12g     |
| Greek yogurt   | 150g   | ~15g     |
| Tuna (canned)  | 100g   | ~25g     |
| **Total**      |        | **~99g** |

---

### Hydration

- **Minimum:** 2 litres of water per day
- **Training days:** Add ~500–750ml per hour of exercise
- Dehydration of even 2% body weight impairs performance and recovery

---

### General principles

- **Eat enough** — under-eating blunts strength, recovery and hormones
- **Prioritise whole foods** — meat, fish, eggs, vegetables, legumes, fruit
- **Time carbs around training** — before for energy, after for glycogen replenishment
- **Don't fear fat** — essential for hormones (including testosterone); aim for 0.8–1g/kg/day
- **Sleep is nutrition** — 7–9 hours; GH and testosterone peak during deep sleep

## Personal notes

### Weights

* Dumbbells: 2x5kg, 2x7.5kg
* Dumbbell
  * disks
    * 2x bar + bolts: 2kg
    * 4 x 1.25kg 
    * 4 x 2.5kg
    * 4 x 5kg
  * combinations (double dumbbell):
    * b + 2.5 + => 7kg
    * b + 2.5 + 1.25 => 9.5kg
    * b + 5 => 12kg
    * b + 5 + 1.25 => 14.5kg
    * b + 5 + 2.5 => 17kg
    * b + 5 + 2.5 + 1.5 => 19.5kg
  * combinations (single dumbbell):
    * b + 4x5 => 22kg
    * b + 4x5 + 2x2.5 => 27kg
* Kettlebell: 6kg, 10kg, 12kg, 16kg

### Schedule

|           | Monday       | Tuesday                    | Wednesday              | Thursday     | Friday                     | Saturday | Sunday              |
| --------- | ------------ | -------------------------- | ---------------------- | ------------ | -------------------------- | -------- | ------------------- |
| Morning   |              | Walk                       |                        |              | Walk                       |          |                     |
| Afternoon | Upper body A | Abs, glutes (weight), legs |                        | Upper body B | Abs, glutes (band), planks |          | Hike? (spontaneous) |
| Evening   | Stretch/yoga |                            | Cardio out (swim/bike) | Stretch/yoga |                            |          |                     |
