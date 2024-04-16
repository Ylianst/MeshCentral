# Contribute to MeshCentral 

## Github PR

## Contribute to MeshCentral's Multilingual Support

To make MeshCentral multilingual, your contributions are crucial. Follow these steps to translate the interface into various languages.

1. **Remove Local Translations:** Delete `translate.json` from your `meshcentral-data` folder. This file contains your local copy of translations, which may become outdated as new features and texts are added.

2. **Access MeshCentral:** Ensure you are logged into MeshCentral.
3. **Open Translation Tool:** Visit `https://YOURMESHCENTRALSERVER.COM/translator.htm` to access the translation interface.
4. **Choose a Language:** Select the language you wish to translate from the list provided.

5. **Translate Text:** Use the search function or scroll through the list to find text segments you want to translate. Utilize the "show no translations only" checkbox to filter untranslated texts.
6. **Enter Translations:** For each text segment, enter your translation in the bottom box (not the top one) and click `SET (F1)`.
7. **Repeat Translation:** Continue translating by repeating steps 5 and 6 for other texts as desired.

8. **Save and Apply Translations**
   - Click `SAVE TO SERVER (F3)` to save your translations to `meshcentral-data/translate.json` locally in your MeshCentral server.
   - Optionally, click `SAVE TO FILE (F4)` to download the `translate.json` file for offline review or sharing.

9. **Deploy Translations:** Click `TRANSLATE SERVER` and allow some time for the process to complete (approximately 5-15 minutes depending on server specifications). This command line output will indicate when the translation is complete.
[pic]

10. **Finalize Changes:** It’s crucial to restart MeshCentral to ensure that the translated files are picked up correctly.
11. **Share your translations:** Once a language translation is complete, take the latest `translation.json` and share it by emailing it to the maintainer (Ylianst, `ylianst@gmail.com`) or by submitting it to the MeshCentral GitHub repository via a pull request.


---

#### Additional Information:
  - If you make any changes to `default.handlebars`, run the translate server to propagate these modifications to the language-specific handlebar files located in `node_modules/meshcentral/views/translations`.

By following these steps, you help MeshCentral support any language you choose, making it more accessible worldwide. By sharing your translations with us, you also help make these languages available to other users, improving the community and extending the software's reach.
