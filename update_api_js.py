import re

with open("js/modules/api.js", "r") as f:
    content = f.read()

# Update guestData
guest_data_replacement = """          const guestData = {
            $id: 'guest',
            email: 'guest@example.com',
            display_name: 'Guest User',
            join_date: new Date().toISOString(),
            auth_method: 'guest',
            english_level: 'A0',
            native_language: 'EN',
            completed_dates: [],
            profilepicurl: 'assets/img/teacherprofile.png' // Default fallback
          };"""
content = re.sub(
    r"          const guestData = \{\s*\$id: 'guest',[^}]+completed_dates: \[\]\s*\};",
    guest_data_replacement,
    content,
    flags=re.DOTALL
)

# Update mergedData
merged_data_replacement = """          const mergedData = {
            $id: user.$id,        // was: id
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'appwrite',
            ...profileDoc,
            profilepicurl: profileDoc?.profilepicurl || 'assets/img/teacherprofile.png'
          };"""
content = re.sub(
    r"          const mergedData = \{\s*\$id: user\.\$id,\s*// was: id[^}]+auth_method: 'appwrite',\s*\.\.\.profileDoc\s*\};",
    merged_data_replacement,
    content,
    flags=re.DOTALL
)

# Update coreData
core_data_replacement = """          const coreData = {
            $id: user.$id,        // was: id
            email: user.email,
            display_name: user.name,
            join_date: user.$createdAt,
            auth_method: 'appwrite',
            profilepicurl: 'assets/img/teacherprofile.png'
          };"""
content = re.sub(
    r"          const coreData = \{\s*\$id: user\.\$id,\s*// was: id[^}]+auth_method: 'appwrite'\s*\};",
    core_data_replacement,
    content,
    flags=re.DOTALL
)

with open("js/modules/api.js", "w") as f:
    f.write(content)
