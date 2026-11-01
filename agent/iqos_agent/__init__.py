"""IQOS Monitor agent: USB history reader and uploader."""
try:
    from iqos_agent._version import __version__  # written by build_agent.ps1 / CI from the git tag
except ImportError:  # running from source
    __version__ = "0.0.0-dev"
