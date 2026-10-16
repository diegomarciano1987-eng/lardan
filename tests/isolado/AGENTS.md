# Isolated tests

- Do not close the shared base.adm connection in individual test files. Why: later suites reuse it during a complete run.