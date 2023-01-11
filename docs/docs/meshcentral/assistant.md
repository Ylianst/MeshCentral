# MeshCentral Assistant

## Initial Setup

## Agent Invite Code

```json
"domains": {
    "": {
        "agentInviteCodes": true
    }
}
```

![agent invite code](images/assistant_agent_code.png)

## Agent Invitation Link

For web page customization:

1. Alongside `meshcentral-data` create a folder called `meshcentral-web`
2. Create a `views` folder in it and copy the file `node_modules/meshcentral/views/invite.handlebars` into it.
3. That copy will be served instead of the default one, you can customize as you want.

![agent invite code](images/assistant_invitation_link.png)

## Email notification

You can also get an email notification when someone clicks the "Request Help" button in the Assistant agent.

![](images/2022-09-06-16-38-57.png)
