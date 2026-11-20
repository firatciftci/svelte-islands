---
title: Benchmark
description: We built one data-heavy page twice, with plain SvelteKit and with islands. This covers HTML size, blocking time, measurement, and where islands don't help.
---

To find out what islands are worth, we built one page twice. Both versions show the same invented shipping data for Harrow Sound, with 120 harbors and 3,000 berths in two sortable tables and a chart. The [plain version](https://firatciftci.github.io/svelte-islands/demo/plain) is ordinary SvelteKit, and the [islands version](https://firatciftci.github.io/svelte-islands/demo/islands) puts the tables and the chart in islands.

We chose a long page of data because that is what islands are for, so you should read these numbers as the favorable case.

<!-- results -->

Recorded on November 20, 2026 with Chromium 156.0.8078.4 on Apple M5 Pro, using Svelte 5.57.3 and SvelteKit 3.1.1, from commit 9fc1f09.

Each cell is the median of 15 runs, with a 95% bootstrap interval in parentheses. The difference tables show the islands median minus the baseline median, with its own interval. n/a means the browser doesn't expose that measure.

A cold start waits for the load event and sorts as soon as each header appears. Settled waits for the network to go quiet and then waits 1.5 seconds before each step.

#### Chromium, Slow 4G, Cold start

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    104 KB (104 to 104) |       190 KB (190 to 190) |    138 KB (138 to 138) |    98 KB (98 to 98) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |    500 ms (496 to 504) |       860 ms (856 to 868) |    656 ms (652 to 656) | 496 ms (492 to 500) |
| DOM nodes                       | 1,024 (1,024 to 1,024) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |             4 (4 to 4) |                3 (3 to 3) |             1 (1 to 1) |          3 (3 to 3) |
| Long-task time above 50 ms      |    661 ms (651 to 679) |       595 ms (588 to 630) |          2 ms (1 to 5) | 566 ms (545 to 586) |
| Total blocking time             |          0 ms (0 to 0) |       210 ms (199 to 221) |          2 ms (1 to 5) |       0 ms (0 to 0) |
| First harbor sort, visible      |    213 ms (210 to 216) |          50 ms (49 to 53) |       41 ms (38 to 42) |    40 ms (37 to 41) |
| First harbor sort, Event Timing |       16 ms (16 to 16) |          48 ms (48 to 56) |       40 ms (40 to 40) |    40 ms (40 to 40) |
| First berth sort, visible       |    512 ms (507 to 531) |       269 ms (261 to 289) |       34 ms (33 to 35) | 276 ms (262 to 287) |
| First berth sort, Event Timing  |       16 ms (16 to 16) |       272 ms (264 to 288) |       32 ms (32 to 32) | 272 ms (264 to 288) |
| Second berth sort, visible      |    244 ms (240 to 257) |       252 ms (248 to 263) |       32 ms (30 to 32) | 253 ms (245 to 257) |
| Second berth sort, Event Timing |    248 ms (240 to 256) |       256 ms (248 to 272) |       32 ms (32 to 32) | 256 ms (248 to 256) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |           Plain, tuned |            Plain, lazy |
| ------------------------------- | ---------------------------: | ---------------------: | ---------------------: |
| HTML                            |          -94 KB (-94 to -94) |    -42 KB (-42 to -42) |       -2 KB (-2 to -2) |
| Downloaded by load              |          -86 KB (-86 to -86) |    -35 KB (-35 to -35) |         +6 KB (6 to 6) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |      +67 KB (67 to 67) |      +50 KB (50 to 50) |
| First contentful paint          |       -360 ms (-372 to -356) | -156 ms (-160 to -148) |       +4 ms (-4 to 12) |
| DOM nodes                       | -17,832 (-17,832 to -17,832) |    -434 (-434 to -434) |      +180 (180 to 180) |
| Long tasks                      |                  +1 (1 to 1) |            +3 (3 to 3) |            +1 (1 to 1) |
| Long-task time above 50 ms      |            +66 ms (22 to 92) |   +659 ms (646 to 678) |     +95 ms (71 to 134) |
| Total blocking time             |       -210 ms (-221 to -200) |       -2 ms (-5 to -1) |          0 ms (0 to 0) |
| First harbor sort, visible      |         +163 ms (158 to 166) |   +173 ms (168 to 177) |   +174 ms (170 to 178) |
| First harbor sort, Event Timing |          -32 ms (-40 to -32) |    -24 ms (-32 to -24) |    -24 ms (-24 to -24) |
| First berth sort, visible       |         +243 ms (226 to 269) |   +479 ms (473 to 513) |   +236 ms (223 to 268) |
| First berth sort, Event Timing  |       -256 ms (-272 to -248) |    -16 ms (-16 to -16) | -256 ms (-272 to -248) |
| Second berth sort, visible      |             -8 ms (-22 to 5) |   +212 ms (209 to 223) |       -9 ms (-20 to 2) |
| Second berth sort, Event Timing |             -8 ms (-24 to 8) |   +216 ms (208 to 224) |       -8 ms (-16 to 8) |

#### Chromium, Slow 4G, Settled

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    175 KB (175 to 175) |       253 KB (253 to 253) |    201 KB (201 to 201) | 161 KB (161 to 161) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |    496 ms (492 to 500) |       860 ms (856 to 876) |    656 ms (656 to 664) | 496 ms (488 to 496) |
| DOM nodes                       | 1,009 (1,009 to 1,009) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |             4 (4 to 4) |                3 (3 to 3) |             1 (1 to 1) |          3 (3 to 3) |
| Long-task time above 50 ms      |    681 ms (667 to 727) |       596 ms (592 to 616) |          2 ms (1 to 4) | 574 ms (559 to 592) |
| Total blocking time             |          0 ms (0 to 0) |       215 ms (202 to 223) |          2 ms (1 to 4) |       0 ms (0 to 0) |
| First harbor sort, visible      |       46 ms (46 to 47) |          52 ms (50 to 53) |       40 ms (39 to 41) |    38 ms (38 to 41) |
| First harbor sort, Event Timing |       16 ms (16 to 16) |          48 ms (48 to 56) |       40 ms (40 to 40) |    40 ms (40 to 40) |
| First berth sort, visible       |    271 ms (266 to 288) |       262 ms (256 to 272) |       35 ms (34 to 36) | 276 ms (272 to 285) |
| First berth sort, Event Timing  |    272 ms (272 to 296) |       264 ms (256 to 272) |       32 ms (32 to 40) | 280 ms (272 to 288) |
| Second berth sort, visible      |    254 ms (251 to 257) |       255 ms (250 to 270) |       31 ms (30 to 32) | 259 ms (258 to 266) |
| Second berth sort, Event Timing |    256 ms (256 to 256) |       256 ms (256 to 272) |       32 ms (32 to 32) | 256 ms (256 to 264) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------------: | ---------------------: | ------------------: |
| HTML                            |          -94 KB (-94 to -94) |    -42 KB (-42 to -42) |    -2 KB (-2 to -2) |
| Downloaded by load              |          -78 KB (-78 to -78) |    -27 KB (-27 to -27) |   +14 KB (14 to 14) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |      +67 KB (67 to 67) |   +50 KB (50 to 50) |
| First contentful paint          |       -364 ms (-380 to -360) | -160 ms (-172 to -156) |      0 ms (-4 to 4) |
| DOM nodes                       | -17,847 (-17,847 to -17,847) |    -449 (-449 to -449) |   +165 (165 to 165) |
| Long tasks                      |                  +1 (1 to 1) |            +3 (3 to 3) |         +1 (1 to 1) |
| Long-task time above 50 ms      |           +85 ms (59 to 132) |   +679 ms (664 to 723) | +107 ms (78 to 157) |
| Total blocking time             |       -215 ms (-222 to -201) |       -2 ms (-5 to -1) |       0 ms (0 to 0) |
| First harbor sort, visible      |             -6 ms (-7 to -3) |         +7 ms (4 to 8) |      +8 ms (5 to 9) |
| First harbor sort, Event Timing |          -32 ms (-40 to -32) |    -24 ms (-24 to -24) | -24 ms (-24 to -24) |
| First berth sort, visible       |             +9 ms (-5 to 29) |   +236 ms (231 to 254) |   -5 ms (-17 to 15) |
| First berth sort, Event Timing  |              +8 ms (0 to 24) |   +240 ms (232 to 256) |   -8 ms (-16 to 16) |
| Second berth sort, visible      |             -1 ms (-11 to 7) |   +223 ms (221 to 227) |   -5 ms (-10 to -1) |
| Second berth sort, Event Timing |              0 ms (-16 to 8) |   +224 ms (224 to 224) |      0 ms (-8 to 0) |

#### Chromium, Slow 3G, Cold start

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |              With islands |            Plain, untuned |              Plain, tuned |               Plain, lazy |
| ------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| HTML                            |             5 KB (5 to 5) |          99 KB (99 to 99) |          47 KB (47 to 47) |             7 KB (7 to 7) |
| Downloaded by load              |       105 KB (104 to 105) |       190 KB (190 to 190) |       138 KB (138 to 138) |          98 KB (98 to 98) |
| Downloaded by end of visit      |       268 KB (268 to 268) |       253 KB (253 to 253) |       201 KB (201 to 201) |       218 KB (218 to 218) |
| First contentful paint          | 1,280 ms (1,276 to 1,296) | 2,024 ms (2,024 to 2,028) | 1,892 ms (1,888 to 1,892) | 1,276 ms (1,272 to 1,276) |
| DOM nodes                       |    1,024 (1,024 to 1,024) | 18,856 (18,856 to 18,856) |    1,458 (1,458 to 1,458) |          844 (844 to 844) |
| Long tasks                      |                4 (4 to 4) |                3 (3 to 3) |                1 (1 to 1) |                3 (3 to 3) |
| Long-task time above 50 ms      |       654 ms (647 to 667) |       578 ms (568 to 587) |             2 ms (2 to 3) |       555 ms (553 to 567) |
| Total blocking time             |             0 ms (0 to 0) |       202 ms (199 to 209) |             2 ms (2 to 3) |             0 ms (0 to 0) |
| First harbor sort, visible      |       335 ms (332 to 421) |          51 ms (50 to 53) |          40 ms (37 to 43) |          38 ms (37 to 40) |
| First harbor sort, Event Timing |          16 ms (16 to 16) |          48 ms (48 to 56) |          40 ms (40 to 40) |          40 ms (40 to 40) |
| First berth sort, visible       | 1,078 ms (1,072 to 1,086) |       262 ms (261 to 264) |          33 ms (32 to 34) |       270 ms (265 to 275) |
| First berth sort, Event Timing  |          16 ms (16 to 16) |       264 ms (264 to 264) |          32 ms (32 to 32) |       272 ms (264 to 272) |
| Second berth sort, visible      |       241 ms (237 to 244) |       244 ms (241 to 245) |          30 ms (30 to 31) |       255 ms (252 to 263) |
| Second berth sort, Event Timing |       240 ms (240 to 248) |       248 ms (248 to 248) |          32 ms (32 to 32) |       256 ms (256 to 264) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |               Plain, tuned |            Plain, lazy |
| ------------------------------- | ---------------------------: | -------------------------: | ---------------------: |
| HTML                            |          -94 KB (-94 to -94) |        -42 KB (-42 to -42) |       -2 KB (-2 to -2) |
| Downloaded by load              |          -85 KB (-86 to -85) |        -33 KB (-35 to -33) |         +7 KB (6 to 7) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |          +67 KB (67 to 67) |      +50 KB (50 to 50) |
| First contentful paint          |       -744 ms (-752 to -728) |     -612 ms (-616 to -596) |        +4 ms (0 to 20) |
| DOM nodes                       | -17,832 (-17,832 to -17,832) |        -434 (-434 to -434) |      +180 (180 to 180) |
| Long tasks                      |                  +1 (1 to 1) |                +3 (3 to 3) |            +1 (1 to 1) |
| Long-task time above 50 ms      |            +76 ms (64 to 95) |       +652 ms (639 to 666) |     +99 ms (84 to 114) |
| Total blocking time             |       -202 ms (-209 to -200) |           -2 ms (-3 to -2) |          0 ms (0 to 0) |
| First harbor sort, visible      |         +284 ms (278 to 371) |       +295 ms (289 to 382) |   +297 ms (292 to 384) |
| First harbor sort, Event Timing |          -32 ms (-40 to -32) |        -24 ms (-24 to -24) |    -24 ms (-24 to -24) |
| First berth sort, visible       |         +816 ms (808 to 825) | +1,045 ms (1,035 to 1,056) |   +808 ms (799 to 819) |
| First berth sort, Event Timing  |       -248 ms (-248 to -248) |        -16 ms (-16 to -16) | -256 ms (-256 to -248) |
| Second berth sort, visible      |              -3 ms (-8 to 2) |       +211 ms (206 to 214) |    -14 ms (-22 to -10) |
| Second berth sort, Event Timing |              -8 ms (-8 to 0) |       +208 ms (208 to 216) |     -16 ms (-24 to -8) |

#### Chromium, Slow 3G, Settled

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |              With islands |            Plain, untuned |              Plain, tuned |               Plain, lazy |
| ------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| HTML                            |             5 KB (5 to 5) |          99 KB (99 to 99) |          47 KB (47 to 47) |             7 KB (7 to 7) |
| Downloaded by load              |       175 KB (175 to 175) |       253 KB (253 to 253) |       201 KB (201 to 201) |       161 KB (161 to 161) |
| Downloaded by end of visit      |       268 KB (268 to 268) |       253 KB (253 to 253) |       201 KB (201 to 201) |       218 KB (218 to 218) |
| First contentful paint          | 1,276 ms (1,272 to 1,280) | 2,024 ms (2,024 to 2,032) | 1,892 ms (1,888 to 1,896) | 1,276 ms (1,276 to 1,296) |
| DOM nodes                       |    1,009 (1,009 to 1,009) | 18,856 (18,856 to 18,856) |    1,458 (1,458 to 1,458) |          844 (844 to 844) |
| Long tasks                      |                4 (4 to 4) |                3 (3 to 3) |                1 (1 to 1) |                3 (3 to 3) |
| Long-task time above 50 ms      |       649 ms (642 to 658) |       574 ms (567 to 592) |             5 ms (2 to 6) |       553 ms (542 to 560) |
| Total blocking time             |             0 ms (0 to 0) |       201 ms (200 to 204) |             5 ms (2 to 6) |             0 ms (0 to 0) |
| First harbor sort, visible      |          46 ms (45 to 46) |          53 ms (50 to 54) |          40 ms (39 to 43) |          39 ms (38 to 40) |
| First harbor sort, Event Timing |          16 ms (16 to 16) |          56 ms (48 to 56) |          40 ms (40 to 40) |          40 ms (40 to 40) |
| First berth sort, visible       | 1,318 ms (1,312 to 1,333) |       261 ms (259 to 267) |          33 ms (32 to 34) |       268 ms (262 to 274) |
| First berth sort, Event Timing  |          16 ms (16 to 16) |       264 ms (256 to 272) |          32 ms (32 to 40) |       272 ms (264 to 272) |
| Second berth sort, visible      |       239 ms (236 to 242) |       245 ms (238 to 250) |          31 ms (31 to 32) |       253 ms (247 to 255) |
| Second berth sort, Event Timing |       240 ms (240 to 240) |       248 ms (240 to 256) |          32 ms (32 to 32) |       256 ms (248 to 256) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |               Plain, tuned |                Plain, lazy |
| ------------------------------- | ---------------------------: | -------------------------: | -------------------------: |
| HTML                            |          -94 KB (-94 to -94) |        -42 KB (-42 to -42) |           -2 KB (-2 to -2) |
| Downloaded by load              |          -78 KB (-78 to -78) |        -27 KB (-27 to -27) |          +14 KB (14 to 14) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |          +67 KB (67 to 67) |          +50 KB (50 to 50) |
| First contentful paint          |       -748 ms (-756 to -744) |     -616 ms (-620 to -608) |            0 ms (-16 to 4) |
| DOM nodes                       | -17,847 (-17,847 to -17,847) |        -449 (-449 to -449) |          +165 (165 to 165) |
| Long tasks                      |                  +1 (1 to 1) |                +3 (3 to 3) |                +1 (1 to 1) |
| Long-task time above 50 ms      |            +75 ms (59 to 85) |       +644 ms (637 to 652) |         +96 ms (82 to 110) |
| Total blocking time             |       -201 ms (-203 to -201) |           -5 ms (-6 to -2) |              0 ms (0 to 0) |
| First harbor sort, visible      |             -7 ms (-9 to -3) |             +6 ms (4 to 7) |             +7 ms (6 to 8) |
| First harbor sort, Event Timing |          -40 ms (-40 to -32) |        -24 ms (-24 to -24) |        -24 ms (-24 to -24) |
| First berth sort, visible       |   +1,058 ms (1,048 to 1,074) | +1,285 ms (1,277 to 1,301) | +1,050 ms (1,040 to 1,071) |
| First berth sort, Event Timing  |       -248 ms (-256 to -248) |        -16 ms (-16 to -16) |     -256 ms (-256 to -248) |
| Second berth sort, visible      |             -5 ms (-10 to 3) |       +208 ms (205 to 211) |         -13 ms (-18 to -7) |
| Second berth sort, Event Timing |             -8 ms (-16 to 0) |       +208 ms (208 to 208) |         -16 ms (-24 to -8) |

#### Chromium, Unthrottled, Cold start

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    103 KB (103 to 103) |       189 KB (189 to 253) |    138 KB (138 to 138) |    97 KB (97 to 97) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |       28 ms (28 to 28) |          72 ms (72 to 72) |       28 ms (28 to 28) |    28 ms (28 to 28) |
| DOM nodes                       | 1,018 (1,018 to 1,018) | 18,855 (18,855 to 18,855) | 1,457 (1,457 to 1,457) |    843 (843 to 843) |
| Long tasks                      |             3 (3 to 4) |                3 (3 to 3) |             0 (0 to 0) |          3 (3 to 3) |
| Long-task time above 50 ms      |       23 ms (19 to 24) |          19 ms (16 to 21) |          0 ms (0 to 0) |    25 ms (24 to 31) |
| Total blocking time             |          0 ms (0 to 0) |             8 ms (7 to 8) |          0 ms (0 to 0) |       0 ms (0 to 0) |
| First harbor sort, visible      |       36 ms (36 to 36) |          29 ms (28 to 30) |       30 ms (29 to 31) |    30 ms (29 to 30) |
| First harbor sort, Event Timing |       16 ms (16 to 16) |          32 ms (32 to 32) |       32 ms (32 to 32) |    32 ms (32 to 32) |
| First berth sort, visible       |       64 ms (62 to 64) |          63 ms (62 to 64) |       18 ms (18 to 18) |    63 ms (62 to 64) |
| First berth sort, Event Timing  |       64 ms (64 to 64) |          64 ms (64 to 64) |       16 ms (16 to 24) |    64 ms (64 to 64) |
| Second berth sort, visible      |       63 ms (62 to 63) |          57 ms (56 to 58) |       17 ms (16 to 18) |    59 ms (58 to 60) |
| Second berth sort, Event Timing |       64 ms (64 to 64) |          56 ms (56 to 64) |       16 ms (16 to 16) |    64 ms (56 to 64) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |        Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------------: | ------------------: | ------------------: |
| HTML                            |          -94 KB (-94 to -94) | -42 KB (-42 to -42) |    -2 KB (-2 to -2) |
| Downloaded by load              |         -86 KB (-150 to -86) | -35 KB (-35 to -35) |      +6 KB (6 to 6) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |   +67 KB (67 to 67) |   +50 KB (50 to 50) |
| First contentful paint          |          -44 ms (-44 to -44) |       0 ms (0 to 0) |       0 ms (0 to 0) |
| DOM nodes                       | -17,837 (-17,837 to -17,837) | -439 (-439 to -439) |   +175 (175 to 175) |
| Long tasks                      |                   0 (0 to 1) |         +3 (3 to 4) |          0 (0 to 1) |
| Long-task time above 50 ms      |              +4 ms (-1 to 8) |   +23 ms (20 to 25) |     -2 ms (-7 to 0) |
| Total blocking time             |             -8 ms (-8 to -7) |       0 ms (0 to 0) |       0 ms (0 to 0) |
| First harbor sort, visible      |               +7 ms (6 to 7) |      +6 ms (5 to 8) |      +6 ms (6 to 7) |
| First harbor sort, Event Timing |          -16 ms (-16 to -16) | -16 ms (-16 to -16) | -16 ms (-16 to -16) |
| First berth sort, visible       |              +1 ms (-2 to 2) |   +46 ms (44 to 47) |     +1 ms (-1 to 3) |
| First berth sort, Event Timing  |                0 ms (0 to 0) |   +48 ms (48 to 48) |       0 ms (0 to 0) |
| Second berth sort, visible      |               +6 ms (5 to 7) |   +46 ms (45 to 47) |      +4 ms (3 to 5) |
| Second berth sort, Event Timing |               +8 ms (0 to 8) |   +48 ms (48 to 48) |       0 ms (0 to 8) |

#### Chromium, Unthrottled, Settled

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    175 KB (175 to 175) |       253 KB (253 to 253) |    201 KB (201 to 201) | 161 KB (161 to 161) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |       28 ms (28 to 28) |          72 ms (72 to 72) |       28 ms (28 to 28) |    28 ms (28 to 28) |
| DOM nodes                       | 1,009 (1,009 to 1,009) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |             4 (3 to 4) |                3 (3 to 3) |             0 (0 to 0) |          3 (3 to 3) |
| Long-task time above 50 ms      |       26 ms (24 to 29) |          25 ms (20 to 26) |          0 ms (0 to 0) |    43 ms (41 to 46) |
| Total blocking time             |          0 ms (0 to 0) |             8 ms (8 to 9) |          0 ms (0 to 0) |       0 ms (0 to 0) |
| First harbor sort, visible      |       36 ms (36 to 37) |          30 ms (28 to 31) |       31 ms (28 to 32) |    33 ms (29 to 35) |
| First harbor sort, Event Timing |       16 ms (16 to 16) |          32 ms (32 to 32) |       32 ms (32 to 32) |    32 ms (32 to 32) |
| First berth sort, visible       |       67 ms (65 to 68) |          66 ms (66 to 67) |       18 ms (17 to 18) |    70 ms (69 to 72) |
| First berth sort, Event Timing  |       72 ms (72 to 72) |          72 ms (64 to 72) |       16 ms (16 to 24) |    72 ms (72 to 72) |
| Second berth sort, visible      |       63 ms (61 to 65) |          60 ms (58 to 62) |       17 ms (16 to 18) |    62 ms (60 to 63) |
| Second berth sort, Event Timing |       64 ms (64 to 64) |          64 ms (64 to 64) |       16 ms (16 to 16) |    64 ms (64 to 64) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |        Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------------: | ------------------: | ------------------: |
| HTML                            |          -94 KB (-94 to -94) | -42 KB (-42 to -42) |    -2 KB (-2 to -2) |
| Downloaded by load              |          -78 KB (-78 to -78) | -27 KB (-27 to -27) |   +14 KB (14 to 14) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |   +67 KB (67 to 67) |   +50 KB (50 to 50) |
| First contentful paint          |          -44 ms (-44 to -44) |       0 ms (0 to 0) |       0 ms (0 to 0) |
| DOM nodes                       | -17,847 (-17,847 to -17,847) | -449 (-449 to -449) |   +165 (165 to 165) |
| Long tasks                      |                  +1 (0 to 1) |         +4 (3 to 4) |         +1 (0 to 1) |
| Long-task time above 50 ms      |              +1 ms (-2 to 6) |   +26 ms (24 to 30) | -17 ms (-21 to -13) |
| Total blocking time             |             -8 ms (-9 to -7) |       0 ms (0 to 0) |       0 ms (0 to 0) |
| First harbor sort, visible      |               +7 ms (6 to 8) |      +5 ms (4 to 9) |      +3 ms (2 to 7) |
| First harbor sort, Event Timing |          -16 ms (-16 to -16) | -16 ms (-16 to -16) | -16 ms (-16 to -16) |
| First berth sort, visible       |              +1 ms (-1 to 2) |   +49 ms (48 to 50) |    -4 ms (-6 to -2) |
| First berth sort, Event Timing  |               0 ms (-8 to 0) |   +56 ms (48 to 56) |      0 ms (-8 to 0) |
| Second berth sort, visible      |               +3 ms (1 to 6) |   +46 ms (45 to 48) |     +1 ms (-1 to 4) |
| Second berth sort, Event Timing |                0 ms (0 to 0) |   +48 ms (48 to 48) |       0 ms (0 to 0) |

#### Chromium, Mobile viewport, slow 4G, Cold start

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    104 KB (104 to 104) |       190 KB (190 to 190) |    138 KB (138 to 138) |    98 KB (98 to 98) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |    500 ms (496 to 504) |       804 ms (800 to 812) |    648 ms (644 to 648) | 496 ms (496 to 500) |
| DOM nodes                       | 1,024 (1,024 to 1,024) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |             7 (7 to 7) |                6 (6 to 6) |             1 (1 to 1) |          5 (5 to 5) |
| Long-task time above 50 ms      |    593 ms (587 to 607) |       539 ms (536 to 555) |          3 ms (1 to 3) | 497 ms (489 to 503) |
| Total blocking time             |          0 ms (0 to 0) |       201 ms (197 to 203) |          3 ms (2 to 3) |       0 ms (0 to 0) |
| First harbor sort, visible      |    206 ms (203 to 219) |       109 ms (106 to 111) |       34 ms (33 to 36) |    35 ms (33 to 36) |
| First harbor sort, Event Timing |       16 ms (16 to 16) |       112 ms (104 to 112) |       32 ms (32 to 32) |    32 ms (32 to 40) |
| First berth sort, visible       |    285 ms (273 to 294) |       264 ms (257 to 269) |       28 ms (28 to 28) | 277 ms (275 to 290) |
| First berth sort, Event Timing  |    288 ms (272 to 296) |       264 ms (256 to 272) |       32 ms (32 to 32) | 280 ms (272 to 288) |
| Second berth sort, visible      |    257 ms (255 to 261) |       247 ms (246 to 249) |       26 ms (26 to 27) | 255 ms (253 to 261) |
| Second berth sort, Event Timing |    256 ms (256 to 264) |       248 ms (248 to 248) |       24 ms (24 to 24) | 256 ms (256 to 264) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |           Plain, tuned |          Plain, lazy |
| ------------------------------- | ---------------------------: | ---------------------: | -------------------: |
| HTML                            |          -94 KB (-94 to -94) |    -42 KB (-42 to -42) |     -2 KB (-2 to -2) |
| Downloaded by load              |          -86 KB (-86 to -86) |    -35 KB (-35 to -35) |       +6 KB (6 to 6) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |      +67 KB (67 to 67) |    +50 KB (50 to 50) |
| First contentful paint          |       -304 ms (-316 to -300) | -148 ms (-152 to -140) |      +4 ms (-4 to 8) |
| DOM nodes                       | -17,832 (-17,832 to -17,832) |    -434 (-434 to -434) |    +180 (180 to 180) |
| Long tasks                      |                  +1 (1 to 1) |            +6 (6 to 6) |          +2 (2 to 2) |
| Long-task time above 50 ms      |            +54 ms (32 to 68) |   +590 ms (581 to 604) |   +96 ms (85 to 114) |
| Total blocking time             |       -201 ms (-203 to -197) |       -3 ms (-3 to -2) |        0 ms (0 to 0) |
| First harbor sort, visible      |           +98 ms (93 to 103) |   +172 ms (169 to 176) | +171 ms (168 to 176) |
| First harbor sort, Event Timing |          -96 ms (-96 to -88) |    -16 ms (-16 to -16) |  -16 ms (-24 to -16) |
| First berth sort, visible       |             +21 ms (6 to 33) |   +257 ms (244 to 267) |    +8 ms (-10 to 18) |
| First berth sort, Event Timing  |             +24 ms (8 to 32) |   +256 ms (240 to 264) |     +8 ms (-8 to 16) |
| Second berth sort, visible      |             +10 ms (7 to 15) |   +231 ms (229 to 235) |      +2 ms (-4 to 7) |
| Second berth sort, Event Timing |              +8 ms (8 to 16) |   +232 ms (232 to 240) |       0 ms (-8 to 8) |

#### Chromium, Mobile viewport, slow 4G, Settled

Bytes are counted from the network events that Chromium reports to DevTools.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    175 KB (175 to 175) |       253 KB (253 to 253) |    201 KB (201 to 201) | 161 KB (161 to 161) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |    500 ms (496 to 504) |       812 ms (804 to 820) |    648 ms (644 to 648) | 500 ms (496 to 508) |
| DOM nodes                       | 1,009 (1,009 to 1,009) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |             7 (7 to 7) |                6 (6 to 6) |             1 (1 to 1) |          5 (5 to 5) |
| Long-task time above 50 ms      |    594 ms (584 to 618) |       543 ms (536 to 580) |          2 ms (2 to 3) | 501 ms (492 to 510) |
| Total blocking time             |          0 ms (0 to 0) |       201 ms (200 to 205) |          2 ms (2 to 3) |       0 ms (0 to 0) |
| First harbor sort, visible      |       43 ms (42 to 44) |       106 ms (104 to 109) |       35 ms (33 to 37) |    35 ms (33 to 37) |
| First harbor sort, Event Timing |       16 ms (16 to 16) |       104 ms (104 to 112) |       32 ms (32 to 40) |    32 ms (32 to 40) |
| First berth sort, visible       |    275 ms (268 to 284) |       266 ms (263 to 270) |       29 ms (28 to 30) | 279 ms (278 to 285) |
| First berth sort, Event Timing  |    280 ms (272 to 288) |       264 ms (264 to 272) |       32 ms (32 to 32) | 280 ms (280 to 288) |
| Second berth sort, visible      |    260 ms (259 to 262) |       251 ms (248 to 254) |       26 ms (26 to 27) | 258 ms (255 to 269) |
| Second berth sort, Event Timing |    264 ms (256 to 264) |       248 ms (248 to 256) |       24 ms (24 to 24) | 256 ms (256 to 272) |

**Islands minus baseline**

| Metric                          |               Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------------: | ---------------------: | ------------------: |
| HTML                            |          -94 KB (-94 to -94) |    -42 KB (-42 to -42) |    -2 KB (-2 to -2) |
| Downloaded by load              |          -78 KB (-78 to -78) |    -27 KB (-27 to -27) |   +14 KB (14 to 14) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |      +67 KB (67 to 67) |   +50 KB (50 to 50) |
| First contentful paint          |       -312 ms (-324 to -304) | -148 ms (-152 to -144) |     0 ms (-12 to 4) |
| DOM nodes                       | -17,847 (-17,847 to -17,847) |    -449 (-449 to -449) |   +165 (165 to 165) |
| Long tasks                      |                  +1 (1 to 1) |            +6 (6 to 6) |         +2 (2 to 2) |
| Long-task time above 50 ms      |            +51 ms (30 to 75) |   +592 ms (582 to 615) |  +93 ms (78 to 117) |
| Total blocking time             |       -201 ms (-203 to -199) |       -2 ms (-5 to -2) |       0 ms (0 to 0) |
| First harbor sort, visible      |          -63 ms (-66 to -61) |        +8 ms (6 to 10) |      +7 ms (5 to 9) |
| First harbor sort, Event Timing |          -88 ms (-96 to -88) |    -16 ms (-24 to -16) | -16 ms (-24 to -16) |
| First berth sort, visible       |             +10 ms (3 to 23) |   +247 ms (240 to 256) |    -4 ms (-11 to 6) |
| First berth sort, Event Timing  |             +16 ms (0 to 24) |   +248 ms (240 to 256) |     0 ms (-16 to 8) |
| Second berth sort, visible      |              +9 ms (6 to 14) |   +234 ms (232 to 240) |     +2 ms (-7 to 7) |
| Second berth sort, Event Timing |             +16 ms (0 to 16) |   +240 ms (232 to 240) |     +8 ms (-8 to 8) |

#### Firefox, Unthrottled, Cold start

Bytes are counted from Playwright's request sizes, because DevTools network events are only available in Chromium. Long tasks and Event Timing aren't available in this browser, so those cells show n/a.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    173 KB (173 to 177) |       260 KB (260 to 260) |    208 KB (208 to 208) | 168 KB (168 to 168) |
| Downloaded by end of visit      |    282 KB (282 to 282) |       267 KB (260 to 267) |    215 KB (215 to 215) | 232 KB (232 to 232) |
| First contentful paint          |       35 ms (32 to 38) |        105 ms (99 to 131) |       43 ms (41 to 46) |    38 ms (34 to 39) |
| DOM nodes                       | 1,022 (1,009 to 1,022) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |                    n/a |                       n/a |                    n/a |                 n/a |
| Long-task time above 50 ms      |                    n/a |                       n/a |                    n/a |                 n/a |
| Total blocking time             |                    n/a |                       n/a |                    n/a |                 n/a |
| First harbor sort, visible      |       13 ms (12 to 13) |          10 ms (10 to 11) |       11 ms (10 to 11) |    10 ms (10 to 11) |
| First harbor sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |
| First berth sort, visible       |       64 ms (62 to 70) |          68 ms (65 to 69) |        10 ms (9 to 11) |    64 ms (60 to 67) |
| First berth sort, Event Timing  |                    n/a |                       n/a |                    n/a |                 n/a |
| Second berth sort, visible      |       57 ms (57 to 60) |          57 ms (56 to 60) |        10 ms (9 to 10) |    57 ms (56 to 60) |
| Second berth sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |

**Islands minus baseline**

| Metric                          |               Plain, untuned |        Plain, tuned |       Plain, lazy |
| ------------------------------- | ---------------------------: | ------------------: | ----------------: |
| HTML                            |          -94 KB (-94 to -94) | -42 KB (-42 to -42) |  -2 KB (-2 to -2) |
| Downloaded by load              |          -86 KB (-86 to -83) | -35 KB (-35 to -31) |    +6 KB (6 to 9) |
| Downloaded by end of visit      |            +15 KB (15 to 22) |   +67 KB (67 to 67) | +50 KB (50 to 50) |
| First contentful paint          |          -70 ms (-79 to -62) |   -8 ms (-13 to -3) |   -3 ms (-6 to 4) |
| DOM nodes                       | -17,834 (-17,849 to -17,834) | -436 (-451 to -436) | +178 (163 to 178) |
| Long tasks                      |                          n/a |                 n/a |               n/a |
| Long-task time above 50 ms      |                          n/a |                 n/a |               n/a |
| Total blocking time             |                          n/a |                 n/a |               n/a |
| First harbor sort, visible      |               +3 ms (1 to 3) |      +2 ms (1 to 3) |    +3 ms (2 to 3) |
| First harbor sort, Event Timing |                          n/a |                 n/a |               n/a |
| First berth sort, visible       |              -4 ms (-6 to 2) |   +54 ms (52 to 60) |    0 ms (-4 to 5) |
| First berth sort, Event Timing  |                          n/a |                 n/a |               n/a |
| Second berth sort, visible      |               0 ms (-3 to 5) |   +47 ms (47 to 53) |    0 ms (-3 to 4) |
| Second berth sort, Event Timing |                          n/a |                 n/a |               n/a |

#### Firefox, Unthrottled, Settled

Bytes are counted from Playwright's request sizes, because DevTools network events are only available in Chromium. Long tasks and Event Timing aren't available in this browser, so those cells show n/a.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    188 KB (188 to 188) |       267 KB (267 to 267) |    215 KB (215 to 215) | 175 KB (175 to 175) |
| Downloaded by end of visit      |    282 KB (282 to 282) |       267 KB (267 to 267) |    215 KB (215 to 215) | 232 KB (232 to 232) |
| First contentful paint          |       36 ms (32 to 37) |       106 ms (100 to 132) |       43 ms (42 to 44) |    37 ms (31 to 40) |
| DOM nodes                       | 1,009 (1,009 to 1,009) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |                    n/a |                       n/a |                    n/a |                 n/a |
| Long-task time above 50 ms      |                    n/a |                       n/a |                    n/a |                 n/a |
| Total blocking time             |                    n/a |                       n/a |                    n/a |                 n/a |
| First harbor sort, visible      |       19 ms (15 to 19) |          11 ms (11 to 12) |       13 ms (10 to 14) |    14 ms (12 to 15) |
| First harbor sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |
| First berth sort, visible       |       63 ms (62 to 69) |          63 ms (62 to 65) |       13 ms (10 to 14) |    63 ms (61 to 66) |
| First berth sort, Event Timing  |                    n/a |                       n/a |                    n/a |                 n/a |
| Second berth sort, visible      |       58 ms (57 to 60) |          58 ms (56 to 59) |       11 ms (11 to 13) |    60 ms (57 to 65) |
| Second berth sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |

**Islands minus baseline**

| Metric                          |               Plain, untuned |        Plain, tuned |       Plain, lazy |
| ------------------------------- | ---------------------------: | ------------------: | ----------------: |
| HTML                            |          -94 KB (-94 to -94) | -42 KB (-42 to -42) |  -2 KB (-2 to -2) |
| Downloaded by load              |          -78 KB (-78 to -78) | -27 KB (-27 to -27) | +14 KB (14 to 14) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |   +67 KB (67 to 67) | +50 KB (50 to 50) |
| First contentful paint          |          -70 ms (-97 to -63) |   -7 ms (-11 to -5) |   -1 ms (-6 to 4) |
| DOM nodes                       | -17,847 (-17,847 to -17,847) | -449 (-449 to -449) | +165 (165 to 165) |
| Long tasks                      |                          n/a |                 n/a |               n/a |
| Long-task time above 50 ms      |                          n/a |                 n/a |               n/a |
| Total blocking time             |                          n/a |                 n/a |               n/a |
| First harbor sort, visible      |               +8 ms (3 to 8) |      +6 ms (2 to 9) |    +5 ms (1 to 7) |
| First harbor sort, Event Timing |                          n/a |                 n/a |               n/a |
| First berth sort, visible       |               0 ms (-3 to 6) |   +50 ms (48 to 57) |    0 ms (-3 to 6) |
| First berth sort, Event Timing  |                          n/a |                 n/a |               n/a |
| Second berth sort, visible      |               0 ms (-2 to 2) |   +47 ms (45 to 49) |   -2 ms (-6 to 2) |
| Second berth sort, Event Timing |                          n/a |                 n/a |               n/a |

#### WebKit, Unthrottled, Cold start

Bytes are counted from Playwright's request sizes, because DevTools network events are only available in Chromium. Long tasks and Event Timing aren't available in this browser, so those cells show n/a.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    166 KB (166 to 166) |       253 KB (253 to 253) |    201 KB (201 to 201) | 160 KB (160 to 160) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |       41 ms (40 to 43) |       273 ms (269 to 280) |       48 ms (47 to 49) |    38 ms (38 to 39) |
| DOM nodes                       | 1,016 (1,016 to 1,016) | 18,853 (18,853 to 18,853) | 1,455 (1,455 to 1,455) |    841 (841 to 841) |
| Long tasks                      |                    n/a |                       n/a |                    n/a |                 n/a |
| Long-task time above 50 ms      |                    n/a |                       n/a |                    n/a |                 n/a |
| Total blocking time             |                    n/a |                       n/a |                    n/a |                 n/a |
| First harbor sort, visible      |       16 ms (16 to 17) |          15 ms (15 to 15) |       16 ms (15 to 16) |    16 ms (16 to 16) |
| First harbor sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |
| First berth sort, visible       |    354 ms (349 to 366) |       245 ms (244 to 246) |       17 ms (16 to 18) | 254 ms (252 to 255) |
| First berth sort, Event Timing  |                    n/a |                       n/a |                    n/a |                 n/a |
| Second berth sort, visible      |    277 ms (272 to 281) |       270 ms (264 to 273) |       16 ms (15 to 16) | 276 ms (269 to 283) |
| Second berth sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |

**Islands minus baseline**

| Metric                          |               Plain, untuned |         Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------------: | -------------------: | ------------------: |
| HTML                            |          -94 KB (-94 to -94) |  -42 KB (-42 to -42) |    -2 KB (-2 to -2) |
| Downloaded by load              |          -86 KB (-86 to -86) |  -35 KB (-35 to -35) |      +6 KB (6 to 6) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |    +67 KB (67 to 67) |   +50 KB (50 to 50) |
| First contentful paint          |       -232 ms (-240 to -227) |     -7 ms (-9 to -5) |      +3 ms (1 to 5) |
| DOM nodes                       | -17,837 (-17,837 to -17,837) |  -439 (-439 to -439) |   +175 (175 to 175) |
| Long tasks                      |                          n/a |                  n/a |                 n/a |
| Long-task time above 50 ms      |                          n/a |                  n/a |                 n/a |
| Total blocking time             |                          n/a |                  n/a |                 n/a |
| First harbor sort, visible      |               +1 ms (1 to 3) |        0 ms (0 to 2) |       0 ms (0 to 1) |
| First harbor sort, Event Timing |                          n/a |                  n/a |                 n/a |
| First berth sort, visible       |         +109 ms (104 to 122) | +337 ms (332 to 350) | +100 ms (95 to 113) |
| First berth sort, Event Timing  |                          n/a |                  n/a |                 n/a |
| Second berth sort, visible      |              +7 ms (2 to 15) | +261 ms (256 to 265) |     +1 ms (-9 to 8) |
| Second berth sort, Event Timing |                          n/a |                  n/a |                 n/a |

#### WebKit, Unthrottled, Settled

Bytes are counted from Playwright's request sizes, because DevTools network events are only available in Chromium. Long tasks and Event Timing aren't available in this browser, so those cells show n/a.

| Metric                          |           With islands |            Plain, untuned |           Plain, tuned |         Plain, lazy |
| ------------------------------- | ---------------------: | ------------------------: | ---------------------: | ------------------: |
| HTML                            |          5 KB (5 to 5) |          99 KB (99 to 99) |       47 KB (47 to 47) |       7 KB (7 to 7) |
| Downloaded by load              |    175 KB (175 to 175) |       253 KB (253 to 253) |    201 KB (201 to 201) | 161 KB (161 to 161) |
| Downloaded by end of visit      |    268 KB (268 to 268) |       253 KB (253 to 253) |    201 KB (201 to 201) | 218 KB (218 to 218) |
| First contentful paint          |       39 ms (39 to 41) |       274 ms (273 to 276) |       48 ms (47 to 48) |    39 ms (38 to 41) |
| DOM nodes                       | 1,009 (1,009 to 1,009) | 18,856 (18,856 to 18,856) | 1,458 (1,458 to 1,458) |    844 (844 to 844) |
| Long tasks                      |                    n/a |                       n/a |                    n/a |                 n/a |
| Long-task time above 50 ms      |                    n/a |                       n/a |                    n/a |                 n/a |
| Total blocking time             |                    n/a |                       n/a |                    n/a |                 n/a |
| First harbor sort, visible      |       22 ms (17 to 24) |          16 ms (16 to 16) |       17 ms (16 to 17) |    16 ms (16 to 17) |
| First harbor sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |
| First berth sort, visible       |    356 ms (354 to 358) |       250 ms (248 to 251) |       28 ms (24 to 30) | 258 ms (255 to 264) |
| First berth sort, Event Timing  |                    n/a |                       n/a |                    n/a |                 n/a |
| Second berth sort, visible      |    270 ms (268 to 272) |       273 ms (269 to 275) |       25 ms (18 to 31) | 270 ms (269 to 273) |
| Second berth sort, Event Timing |                    n/a |                       n/a |                    n/a |                 n/a |

**Islands minus baseline**

| Metric                          |               Plain, untuned |         Plain, tuned |        Plain, lazy |
| ------------------------------- | ---------------------------: | -------------------: | -----------------: |
| HTML                            |          -94 KB (-94 to -94) |  -42 KB (-42 to -42) |   -2 KB (-2 to -2) |
| Downloaded by load              |          -78 KB (-78 to -78) |  -27 KB (-27 to -27) |  +14 KB (14 to 14) |
| Downloaded by end of visit      |            +15 KB (15 to 15) |    +67 KB (67 to 67) |  +50 KB (50 to 50) |
| First contentful paint          |       -235 ms (-236 to -233) |     -9 ms (-9 to -7) |     0 ms (-2 to 1) |
| DOM nodes                       | -17,847 (-17,847 to -17,847) |  -449 (-449 to -449) |  +165 (165 to 165) |
| Long tasks                      |                          n/a |                  n/a |                n/a |
| Long-task time above 50 ms      |                          n/a |                  n/a |                n/a |
| Total blocking time             |                          n/a |                  n/a |                n/a |
| First harbor sort, visible      |               +6 ms (4 to 8) |       +5 ms (3 to 7) |     +6 ms (3 to 8) |
| First harbor sort, Event Timing |                          n/a |                  n/a |                n/a |
| First berth sort, visible       |         +106 ms (103 to 108) | +328 ms (325 to 332) | +98 ms (92 to 102) |
| First berth sort, Event Timing  |                          n/a |                  n/a |                n/a |
| Second berth sort, visible      |              -3 ms (-6 to 3) | +245 ms (239 to 254) |     0 ms (-3 to 4) |
| Second berth sort, Event Timing |                          n/a |                  n/a |                n/a |

<!-- /results -->

## What the numbers show

The load is where islands help. On slow 4G, the islands page sends 5 KB of HTML instead of 99 KB, paints first at 500 ms instead of 860 ms, and has no blocking time before the first sort, against about 210 ms on the untuned page. The plain page sends every row as HTML and again as data, and it can't respond to anything until it has hydrated all of them. The islands page sends the HTML for the harbors, leaves the berths out until you scroll toward them, and hydrates neither table until you reach for it. The lazy page gets most of the same load without islands, by fetching the berths itself: 7 KB of HTML, and a first paint within a few milliseconds of the islands page.

The work isn't gone, though, only moved. Over the whole visit, the islands page spends more time in long tasks than any of the plain pages: 51 to 85 ms more than the untuned page in the throttled Chromium conditions, and 93 to 107 ms more than the lazy one, because once the tables are hydrated, it does the same hydration work as the plain page, plus the library's own work. The tuned page spends almost none, but it does less, since it renders and sorts 100 berths instead of 3,000. Unthrottled, all four pages are within a few milliseconds of each other.

The first sort is where islands lose, when the visitor is quick. A cold visit sorts as soon as the header exists, so the islands page has to fetch the table's code first. On slow 4G, the first harbor sort shows after 213 ms, against 50 ms on the untuned page and 40 ms on the lazy one. On slow 3G it's 335 ms against 51 ms, and the first berth sort takes 1,078 ms against 262 ms, because the berths' data is still downloading. Our goal for 1.1 was a cold first sort on slow 4G within 1.5 times the plain page's, and we missed it by a wide margin. A quick visitor's first click costs at least one round trip for the island's code, and we haven't found a way around that which doesn't move the bytes back into the load.

A settled visit gives the browser time to fetch each table's data and code while it's idle, and then the first sorts are within 10 ms of the untuned page on slow 4G and unthrottled (on the phone viewport, the first harbor sort is 63 ms faster). Slow 3G is the exception: 1.5 seconds after scrolling, the berths' HTML and data are still arriving, so the first berth sort takes 1,318 ms against 260 ms. The second sort in each visit, once everything has hydrated, is within about 10 ms of the plain page everywhere.

Firefox matches the plain page on every sort. WebKit matches it on the harbors, but its first berth sort is about 100 ms slower in both modes, against both the untuned and the lazy page, and we haven't traced why yet.

## Where islands don't help

- a quick visitor's first interaction on a slow connection, which waits for the island's code, as the cold sorts above show
- the total time spent in long tasks over a visit, which is a little higher than on the plain page, since the hydration still happens and the library adds its own work
- a visitor who uses every table downloads about as much as they do on the plain page, or slightly more, because the HTML and the data arrive separately
- the library adds about 11 KB of compressed JavaScript to every page that uses it
- a small part doesn't become an island at all (see [small parts](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page)), so a short page has nothing to gain
- once everything is hydrated, the page is doing the same work as the plain one

If people usually open your page to sort its only table, and their connections are slow, an island moves the cost from the load to the moment they care about, and you may prefer to keep that table out of an island or to [wake it early](../20-core-concepts/30-when-islands-wake.md).

## How it's measured

The islands page is compared against three plain SvelteKit pages, because "plain" can mean an app nobody has tuned or one somebody has:

- [untuned](https://firatciftci.github.io/svelte-islands/demo/plain), which renders every row of both tables
- [tuned](https://firatciftci.github.io/svelte-islands/demo/plain-tuned), which renders the first 100 berths and has a "Show all berths" button for the rest
- [lazy](https://firatciftci.github.io/svelte-islands/demo/plain-lazy), which leaves the berths out of the page and fetches them from a prerendered `+server.ts` route once the table comes within 320 px of the viewport — the same margin the islands page uses, so this is the fair comparison for a deferred island

Each visit uses a new browser context, so nothing is cached, and a small local server sends the built site with gzip. The pages take turns going first, because the machine may be busier at one moment than another.

Chromium runs under four conditions:

- slow 4G, the settings Lighthouse uses for its mobile test: 4x CPU slowdown, 150 ms of latency, 1.6 Mbps down, and 750 Kbps up
- slow 3G: 4x CPU slowdown, 400 ms of latency, and 500 Kbps each way
- unthrottled
- a 390 by 844 phone viewport with touch, on slow 4G

Firefox and WebKit run unthrottled only, since the throttling goes through the DevTools protocol, which only Chromium has. The desktop window is 1280 by 800.

Every page, condition, and browser gets 15 visits in each of two modes. A _cold_ visit waits for the `load` event and then sorts as soon as each header button exists, which is roughly what an impatient visitor does. A _settled_ visit waits for the network to go quiet, and then another 1.5 seconds, before each step. Either way, a visit goes like this:

- load the page and read the numbers for the load
- sort the harbors by On time
- scroll to the berths
- sort the berths by On time, then by Arrivals
- wait 5 seconds and read the totals

The sorts use On time and Arrivals because those are the number columns a phone still shows (the narrow layout hides Departures and Cargo), and the same columns are used in every condition so that the timings can be compared. The tables start sorted by Arrivals, which is why the first sort in each table is On time.

A sort is timed twice. The _visible_ time runs from the press of the pointer to the first frame after the column header changes, in every browser. The Event Timing number is the longest event the browser reports for that interaction, which only Chromium exposes. It ignores events under 16 ms, so those show as 0.

_Long-task time_ adds up the part of each long task beyond 50 ms, over the whole visit, so it includes the sorts. _Total blocking time_ counts the same thing from first contentful paint to the first sort, so it measures only the load. Lighthouse ends that window at time to interactive instead, but that needs 5 quiet seconds, and a cold visit doesn't wait that long (Lighthouse itself dropped time to interactive in version 10). That window leans toward islands, since an island puts off its work until someone reaches for it, and total blocking time never sees work that happens after the first sort. That work shows up in long-task time and in the sort timings, so read those as the fair comparison, and total blocking time as what the load alone costs. In cold mode the first sort comes right after the load, so the window is short for every page. Long tasks are Chromium only, too.

Chromium counts bytes from the network events it reports to DevTools, with the main document counted as HTML. Firefox and WebKit count them from Playwright's request sizes, which include the response headers, so compare bytes within a browser and not across browsers.

Each number is the median of its 15 visits, and the parentheses hold a 95% bootstrap interval (2,000 resamples, with a fixed seed so a rerun over the same data gives the same intervals). The difference tables subtract each baseline's median from the islands median, with an interval of their own. When a difference's interval includes 0, the two pages aren't measurably apart.

Each visit also writes a JSON file to `docs/benchmark-raw/`, with its numbers and the timings they came from (long tasks, requests, and first contentful paint), so you can recompute any of them. Chromium visits also record a trace, which is gzipped and published with the release rather than committed, since all 480 come to about 150 MB. `checksums.txt` lists the SHA-256 of every file, and `docs/benchmark.json` records the browser versions, the operating system, the CPU, the package versions, and the commit.

## Running it yourself

The script lives in `site/bench/run.ts`. It needs all three browsers, which Playwright can install...

```sh
pnpm exec playwright install chromium firefox webkit
pnpm run bench
```

...and it rewrites the tables on this page, along with `docs/benchmark.json`, which the home page reads. A full run takes 2 to 3 hours, and it's worth leaving the machine alone while it does.

The home page also has a button that runs the untuned and islands pages in your own browser. That version uses no slowdown and reports fewer numbers, but it's your machine and your connection.
