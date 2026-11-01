"""Version comparison and the source/exe guard of the self-updater."""
from iqos_agent.updater import parse_version, is_newer, current_exe, check_and_apply

assert parse_version("v0.1.7") == (0, 1, 7)
assert parse_version("0.1.7-3-gabcdef") == (0, 1, 7)
assert parse_version("0.0.0-dev") == (0, 0, 0)
assert parse_version("garbage") == ()
assert is_newer("v0.1.7", "0.1.6")
assert is_newer("v0.2.0", "0.1.9-5-g123")
assert not is_newer("v0.1.6", "0.1.6")
assert not is_newer("v0.1.5", "0.1.6")
assert not is_newer("garbage", "0.1.6")
assert not is_newer("v0.1.7", "")
# Running from source never updates.
assert current_exe() is None
assert check_and_apply(force=True) == "source"
print("UPDATER VERSION LOGIC: PASSED")
