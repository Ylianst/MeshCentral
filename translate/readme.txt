You can help translate MeshCentral into other languages pretty easily. In this folder is a
"translate.json" file containing the english strings and translated strings in other languages.

Download the following Windows tool to open the "translate.json" file and edit strings.

  https://info.meshcentral.com/downloads/MeshCentral2/ResourceTranslator.zip

Once done, save the file back and run this:

  node translate.js translateall

This will re-generate all of the translated web pages with the new strings. You can then do a
GitHub pull request on the MeshCentral GitHub to update the "translate.json" file, or send the
file to "ylianst@gmail.com".
