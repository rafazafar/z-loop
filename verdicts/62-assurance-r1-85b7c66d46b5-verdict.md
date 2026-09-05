VERDICT: PASS
TASK: works
BENCH: none
PROFILE: assurance
ROUND: 1
PR: https://github.com/kokoromil/kokolog-monitor/pull/128
BASE_OID: cc8b5140ddfd0b60050a444ebee234e916e5785e
HEAD_OID: 85b7c66d46b59213ed4ac70f33251aa6cdb33290
expected: per-lane display gain and global time horizon verified across acceptance, code, security, qms, and safety
observed: independent lane gain and atomic 4/8/16s horizon match approved design with full test matrix pass
evidence: apps/mobile_monitor/lib/src/presentation/monitor_screens.dart,apps/mobile_monitor/lib/src/presentation/single_lane_ecg_card.dart,apps/mobile_monitor/test/gain_time_horizon_test.dart
blockers:
- none
advisories:
- none
