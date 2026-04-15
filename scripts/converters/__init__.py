"""Platform converters for SkillForge multi-agent export.

Each converter translates a Claude Code SKILL.md into the target platform's
skill / rules / context format. Converters are stateless — convert.py does
all the I/O and just asks converters to transform strings.
"""
