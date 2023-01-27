# Plugins - Installation & Usage

!!!note
     Plugins as such receive **no support** by the main developers of MeshCentral. If you experience problems with MeshCentral please make sure to **disable all plugins before further troubleshooting**!

## Use Cases

Certain feature requests may not be suitable for all MeshCentral users and thus are available as a plugin. Furthermore users can develop their own plugins - as described further below - to extend functionality or benefit from integrating the powerful MeshCentral into their existing application environment much better.

## List of publically available plugins

<https://github.com/topics/meshcentral-plugin>

## Installation of a plugin

1. First please make sure that you enable plugins in the configuration
   >"plugins": {
   >    "enabled": true
   >},
2. Restart MeshCentral in case you just enabled plugins in the configuration.
2. Log into MeshCentral as full administrator.
3. Go my `My Server` -> `Plugins`, hit the Download plugin button.
4. A dialog opens requesting an URL, e.g. put in: <https://github.com/ryanblenis/MeshCentral-ScriptTask>
5. The plugin pops up in the plugin list below the download button, you can now configure and enable/disable it.

# Plugins - Development & Hooks

!!!note
     Plugins as such receive **no support** by the main developers of MeshCentral. If you experience problems with MeshCentral please make sure to **disable all plugins before further troubleshooting**!

## Overview

Not all feature requests may be suitable for all MeshCentral users and thus can't be integrated into MeshCentral directly. Hwoever, Instead of maintaining a complete fork of MeshCentral it is so much easier to benefit from and extend MeshCentral's functionality by using hooks and writing plugins for it.

## Anatomy of a plugin:

    - plugin_name/
    -- config.json
    -- plugin_name.js
    -- modules_meshcore/ // optional
    --- plugin_name.js 	// optional

## Plugin Configuration File

A valid JSON object within a file named `config.json` in the root folder of your project. An example:

    {
      "name": "Plugin Name",
      "shortName": "plugin_name",
      "version": "0.0.0",
      "author": "Author Name",
      "description": "Short Description of the plugin",
      "hasAdminPanel": false,
      "homepage": "https://www.example.com",
      "changelogUrl": "https://raw.githubusercontent.com/User/Project/master/changelog.md",
      "configUrl": "https://raw.githubusercontent.com/User/Project/master/config.json",
      "downloadUrl": "https://github.com/User/Project/archive/master.zip",
      "repository": {
        "type": "git",
        "url": "https://github.com/User/Project.git"
      },
      "versionHistoryUrl": "https://api.github.com/repos/User/Project/tags",
      "meshCentralCompat": ">0.4.3"
    }

## Configuration File Properties

| Field             | Required | Type        | Description                                                  |
| ----------------- | -------- | ----------- | ------------------------------------------------------------ |
| name              | Yes      | string      | a human-readable name for the plugin                         |
| shortName         | Yes      | string      | an alphanumeric, unique short identifier for the plugin (will be used to access your functions throughout the project |
| version           | Yes      | string      | the current version of the plugin                            |
| author            | No       | string      | the author's name                                            |
| description       | Yes      | string      | a short, human-readable description of what the plugin does  |
| hasAdminPanel     | Yes      | boolean     | `true` or `false`, indicates whether or not the plugin will offer its own administrative interface |
| homepage          | Yes      | string      | the URL of the projects homepage                             |
| changelogUrl      | Yes      | string      | the URL to the changelog of the project                      |
| configUrl         | Yes      | string      | the URL to the config.json of the project                    |
| downloadUrl       | Yes      | string      | the URL to a ZIP of the project (used for installation/upgrades) |
| repository        | Yes      | JSON object | contains the following attributes                            |
| repository.type   | Yes      | string      | valid values are `git` and in the future, `npm` will also be supported in the future |
| repository.url    | Yes      | string      | the URL to the project's repository                          |
| versionHistoryUrl | No       | string      | the URL to the project's versions/tags                       |
| meshCentralCompat | Yes      | string      | the minimum version string of required compatibility with the MeshCentral server, can be formatted as "0.1.2-c" or ">=0.1.2-c". Currently only supports minimum version, not full semantic checking. |

## Plugin Hooks

In essence, hooks are locations in the code which enable developers to tap into a module to either provide alternative behavior or to respond to an event.

These are separated into the following categories depending on the type of functionality the plugin should offer.

- Web UI, to modify the MeshCentral admin interface
- Back End, to modify core functionality of the server and communicate with the Web UI layer as well as the Mesh Agent (Node) layer to send commands and data
- Mesh Agent (Node), to introduce functionality to each agent

### Web UI Hooks

- `onDeviceRefreshEnd`: called when a device is selected in the MeshCentral web interface
- `registerPluginTab`: callable when a device is selected in the MeshCentral web interface to register a new tab for plugin data, if required. Accepts an object, or function that returns an object, with the following properties: { tabId: "yourShortNameHere", tabTitle: "Your Display Name"}. A tab and div with the associated ID and title will be created for your use
- `onDesktopDisconnect`: called when a remote desktop session is disconnected
- `onWebUIStartupEnd`: called when the page has loaded for the first time after a login / refresh
- `goPageStart`: called before page changes take effect. Passes 2 arguments (<page number> : int, <event> : Event)
- `goPageEnd`: called after page changes take effect. Passes 2 arguments (<page number> : int, <event> : Event)

#### Exports

Any function can be exported to the Web UI layer by adding the name of the function to an `exports` array in the plugin object.

### Back End Hooks

- `server_startup`: called once when the server starts (or when the plugin is first installed)
- `hook_agentCoreIsStable`: called once when an agent initially checks in
- `hook_processAgentData`: called each time an agent transmits data back to the server
- `hook_userLoggedIn`: called when a user has logged into the web interface
- `hook_setupHttpHandlers`: called before all http handlers are setup

### Mesh Agent

Use of the optional file `plugin_name.js` in the optional folder `modules_meshcore` will include the file in the default meshcore file sent to each endpoint. This is useful to add functionality on each of the endpoints.

## Structure

Much of MeshCentral revolves around returning objects for your structures, and plugins are no different. Within your plugin you can traverse all the way up to the web server and MeshCentral Server classes to access all the functionality those layers provide. This is done by passing the current object to newly created objects, and assigning that reference to a `parent` variable within that object.


## Versioning

Versioning your plugin correctly and consistently is essential to ensure users of your plugin are prompted to upgrade when it is available. Semantic versioning is recommended.

## Changelog

A changelog is highly recommended so that your users know what's changed since their last version.

## Sample Plugin

[MeshCentral-Sample](https://github.com/ryanblenis/MeshCentral-Sample) is a simple plugin that, upon disconnecting from remote desktop, prompts the user to enter a manual event (note), pre-filled in with the date and timestamp.
