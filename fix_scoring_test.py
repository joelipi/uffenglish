import re

with open("js/modules/scoring.test.js", "r") as f:
    content = f.read()

# Add hesitation: 0 to the mock test objects
content = content.replace("pauseCount: 0,", "pauseCount: 0,\n                hesitation: 0,")
content = content.replace("pauseCount: 2,", "pauseCount: 2,\n                hesitation: 0,")

with open("js/modules/scoring.test.js", "w") as f:
    f.write(content)
