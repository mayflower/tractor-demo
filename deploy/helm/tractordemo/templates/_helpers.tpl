{{- define "tractordemo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "tractordemo.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "tractordemo.name" . -}}
{{- end -}}
{{- end -}}

{{- define "tractordemo.labels" -}}
app.kubernetes.io/name: {{ include "tractordemo.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "tractordemo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tractordemo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "tractordemo.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{- define "tractordemo.pullPolicy" -}}
{{- .Values.image.pullPolicy | default .Values.global.imagePullPolicy | default "IfNotPresent" -}}
{{- end -}}
