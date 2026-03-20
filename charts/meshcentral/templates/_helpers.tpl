{{- define "meshcentral.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "meshcentral.labels" -}}
app.kubernetes.io/name: {{ include "meshcentral.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "meshcentral.selectorLabels" -}}
app.kubernetes.io/name: {{ include "meshcentral.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
