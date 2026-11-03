#Requires -Version 5.1
<#
.SYNOPSIS
  记忆海 · 用 PowerShell 增删群号 / 私聊账号 / 管理员

.EXAMPLE
  .\scripts\access.ps1 list
  .\scripts\access.ps1 add-group 1130480362
  .\scripts\access.ps1 add-user 180108719
  .\scripts\access.ps1 add-admin 180108719
  .\scripts\access.ps1 remove-group 1130480362
  .\scripts\access.ps1 remove-user 180108719
  .\scripts\access.ps1 remove-admin 180108719
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet(
    "list", "ls",
    "add-group", "add-g", "ag",
    "add-user", "add-u", "au",
    "add-admin", "add-a", "aa",
    "remove-group", "rm-group", "rg",
    "remove-user", "rm-user", "ru",
    "remove-admin", "rm-admin", "ra",
    "help", "-h", "--help"
  )]
  [string]$Command,

  [Parameter(Position = 1)]
  [string]$Id,

  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  Split-Path -Parent $PSScriptRoot
}

function Resolve-ConfigPath {
  if ($ConfigPath) { return (Resolve-Path $ConfigPath).Path }
  Join-Path (Get-RepoRoot) "config.json"
}

function Read-Config([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "找不到配置文件：$path"
  }
  $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  return $raw | ConvertFrom-Json
}

function Write-Config([string]$path, $cfg) {
  $json = $cfg | ConvertTo-Json -Depth 30
  # PowerShell 5 可能输出 Unicode 转义；Node 读 JSON 没问题。统一 UTF-8 无 BOM。
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($path, $json + "`n", $utf8NoBom)
}

function Ensure-Access($cfg) {
  if (-not $cfg.access) {
    $cfg | Add-Member -NotePropertyName access -NotePropertyValue ([pscustomobject]@{
      admins         = @()
      allowUsers     = @()
      allowGroups    = @()
      requireMention = $false
      triggerNames   = @()
    })
  }
  foreach ($key in @("admins", "allowUsers", "allowGroups")) {
    if (-not $cfg.access.$key) {
      $cfg.access | Add-Member -NotePropertyName $key -NotePropertyValue @() -Force
    }
    # ConvertFrom-Json 单元素时常变成字符串，统一成数组
    $val = $cfg.access.$key
    if ($null -eq $val) {
      $cfg.access.$key = @()
    } elseif ($val -is [string]) {
      $cfg.access.$key = @($val)
    } elseif ($val -isnot [System.Array]) {
      $cfg.access.$key = @($val)
    }
  }
  return $cfg
}

function Normalize-Id([string]$raw) {
  if (-not $raw) { throw "请提供 QQ 号或群号，例如：.\scripts\access.ps1 add-group 123456" }
  $id = $raw.Trim()
  if ($id -notmatch '^\d+$') {
    throw "号码必须是纯数字，收到：$raw"
  }
  return $id
}

function Add-Unique([string[]]$list, [string]$id) {
  if ($list -contains $id) { return @{ list = @($list); added = $false } }
  return @{ list = @($list + $id); added = $true }
}

function Remove-Id([string[]]$list, [string]$id) {
  $next = @($list | Where-Object { $_ -ne $id })
  return @{ list = $next; removed = ($next.Count -ne $list.Count) }
}

function Show-List($cfg) {
  Write-Host ""
  Write-Host "管理员 admins:"
  if ($cfg.access.admins.Count -eq 0) { Write-Host "  （空）" }
  else { $cfg.access.admins | ForEach-Object { Write-Host "  $_" } }

  Write-Host ""
  Write-Host "私聊白名单 allowUsers:"
  if ($cfg.access.allowUsers.Count -eq 0) {
    Write-Host "  （空 = 不限制私聊，谁都能聊）"
  } else {
    $cfg.access.allowUsers | ForEach-Object { Write-Host "  $_" }
  }

  Write-Host ""
  Write-Host "群白名单 allowGroups:"
  if ($cfg.access.allowGroups.Count -eq 0) {
    Write-Host "  （空 = 不限制群，任何群都能用）"
  } else {
    $cfg.access.allowGroups | ForEach-Object { Write-Host "  $_" }
  }

  Write-Host ""
  Write-Host "requireMention = $($cfg.access.requireMention)"
  Write-Host ""
  Write-Host "改完后请重启 bridge 才会生效。"
}

function Show-Help {
  @"
记忆海 access 管理（改 config.json）

用法（在项目根目录）：
  pwsh -File .\scripts\access.ps1 list
  pwsh -File .\scripts\access.ps1 add-group  <群号>
  pwsh -File .\scripts\access.ps1 add-user   <QQ号>
  pwsh -File .\scripts\access.ps1 add-admin  <QQ号>
  pwsh -File .\scripts\access.ps1 remove-group <群号>
  pwsh -File .\scripts\access.ps1 remove-user  <QQ号>
  pwsh -File .\scripts\access.ps1 remove-admin <QQ号>

缩写：
  ag / au / aa   = add-group / add-user / add-admin
  rg / ru / ra   = remove-group / remove-user / remove-admin
  ls             = list

说明：
  - 管理员才能在 QQ 里切人设、收藏表情。
  - allowUsers / allowGroups 为空表示不限制；有内容则只放行列表内。
  - 修改后需要重启 bridge。
"@ | Write-Host
}

$path = Resolve-ConfigPath
$cfg = Ensure-Access (Read-Config $path)

switch -Regex ($Command) {
  "^(help|-h|--help)$" {
    Show-Help
    break
  }
  "^(list|ls)$" {
    Write-Host "配置文件：$path"
    Show-List $cfg
    break
  }
  "^(add-group|add-g|ag)$" {
    $id = Normalize-Id $Id
    $r = Add-Unique @($cfg.access.allowGroups) $id
    $cfg.access.allowGroups = $r.list
    Write-Config $path $cfg
    if ($r.added) { Write-Host "已添加群 $id" } else { Write-Host "群 $id 已在白名单，未重复添加" }
    Write-Host "请重启 bridge 生效。"
    break
  }
  "^(add-user|add-u|au)$" {
    $id = Normalize-Id $Id
    $r = Add-Unique @($cfg.access.allowUsers) $id
    $cfg.access.allowUsers = $r.list
    Write-Config $path $cfg
    if ($r.added) { Write-Host "已添加私聊用户 $id" } else { Write-Host "用户 $id 已在私聊白名单" }
    Write-Host "请重启 bridge 生效。"
    break
  }
  "^(add-admin|add-a|aa)$" {
    $id = Normalize-Id $Id
    $r = Add-Unique @($cfg.access.admins) $id
    $cfg.access.admins = $r.list
    # 顺带放进私聊白名单，方便私聊下指令
    $u = Add-Unique @($cfg.access.allowUsers) $id
    $cfg.access.allowUsers = $u.list
    Write-Config $path $cfg
    if ($r.added) { Write-Host "已添加管理员 $id" } else { Write-Host "管理员 $id 已存在" }
    if ($u.added) { Write-Host "同时加入私聊白名单 allowUsers" }
    Write-Host "请重启 bridge 生效。"
    break
  }
  "^(remove-group|rm-group|rg)$" {
    $id = Normalize-Id $Id
    $r = Remove-Id @($cfg.access.allowGroups) $id
    $cfg.access.allowGroups = $r.list
    Write-Config $path $cfg
    if ($r.removed) { Write-Host "已移除群 $id" } else { Write-Host "群 $id 不在白名单" }
    Write-Host "请重启 bridge 生效。"
    break
  }
  "^(remove-user|rm-user|ru)$" {
    $id = Normalize-Id $Id
    $r = Remove-Id @($cfg.access.allowUsers) $id
    $cfg.access.allowUsers = $r.list
    Write-Config $path $cfg
    if ($r.removed) { Write-Host "已移除私聊用户 $id" } else { Write-Host "用户 $id 不在私聊白名单" }
    Write-Host "请重启 bridge 生效。"
    break
  }
  "^(remove-admin|rm-admin|ra)$" {
    $id = Normalize-Id $Id
    $r = Remove-Id @($cfg.access.admins) $id
    $cfg.access.admins = $r.list
    Write-Config $path $cfg
    if ($r.removed) { Write-Host "已移除管理员 $id" } else { Write-Host "管理员 $id 不在列表" }
    Write-Host "请重启 bridge 生效。"
    break
  }
}
