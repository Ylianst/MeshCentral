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

## Agent Invitation 
Click on the 'Invite' button next to the device group name to access it.  
### Link Invitation
For link invitation web page customization:

1. Alongside `meshcentral-data` create a folder called `meshcentral-web`
2. Create a `views` folder in it and copy the file `node_modules/meshcentral/views/invite.handlebars` into it.
3. That copy will be served instead of the default one, so you can customize it as you want.

![agent invite code](images/assistant_invitation_link.png)

### Email Invitation
This option will show up if you have an SMTP email server set up with MeshCentral.  

For invitation email customization:  

1. Alongside `meshcentral-data` create a folder called `meshcentral-web`
2. Create an `emails` folder in it and copy the files `node_modules/meshcentral/emails/mesh-invite.txt` and `node_modules/meshcentral/emails/mesh-invite.html` into it.
3. These copies will be used instead of the default ones, so you can customize them as you want.

![email-invitation](images/email-invitation.png)

## Email notification

You can also get an email notification when someone clicks the "Request Help" button in the Assistant agent.

![](images/2022-09-06-16-38-57.png)
