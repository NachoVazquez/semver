import * as gitRawCommits from 'git-raw-commits';
import { EMPTY, Observable, throwError } from 'rxjs';
import { catchError, last, map, scan, startWith } from 'rxjs/operators';
import { exec } from '../../common/exec';
import { logStep } from './logger';
import { formatTag } from './tag';

export const DEFAULT_COMMIT_MESSAGE_FORMAT =
  'chore(${projectName}): release ${version}';

/**
 * Return the list of commits since `since` commit.
 */
export function getCommits({
  projectRoot,
  since,
}: {
  projectRoot: string;
  since: string;
}): Observable<string[]> {
  return new Observable<string>((observer) => {
    gitRawCommits({
      from: since,
      path: projectRoot,
    })
      .on('data', (data: string) => observer.next(data))
      .on('error', (error: Error) => observer.error(error))
      .on('close', () => observer.complete())
      .on('finish', () => observer.complete());
  }).pipe(
    scan((commits, commit) => [...commits, commit], [] as string[]),
    startWith([]),
    last()
  );
}

export function tryPush({
  remote,
  branch,
  noVerify,
}: {
  remote: string;
  branch: string;
  noVerify: boolean;
}): Observable<string> {
  if (remote == null || branch == null) {
    return throwError(
      () =>
        new Error(
          'Missing Git options --remote or --branch, see: https://github.com/jscutlery/semver#configure'
        )
    );
  }

  const gitPushOptions = [
    '--follow-tags',
    ...(noVerify ? ['--no-verify'] : []),
  ];

  return exec('git', ['push', ...gitPushOptions, '--atomic', remote, branch])
    .pipe(
      catchError((error) => {
        if (
          /atomic/.test(error) ||
          (process.env.GIT_REDIRECT_STDERR === '2>&1' && /atomic/.test(error))
        ) {
          console.warn('git push --atomic failed, attempting non-atomic push');
          return exec('git', ['push', ...gitPushOptions, remote, branch]);
        }

        return throwError(() => error);
      })
    )
    .pipe(logStep({ step: 'push_success', message: `Pushed to "${remote}" "${branch}"` }));
}

export function addToStage({
  paths,
  dryRun,
}: {
  paths: string[];
  dryRun: boolean;
}): Observable<void> {
  if (paths.length === 0) {
    return EMPTY;
  }

  const gitAddOptions = [...(dryRun ? ['--dry-run'] : []), ...paths];
  return exec('git', ['add', ...gitAddOptions]).pipe(map(() => undefined));
}

export function getFirstCommitRef(): Observable<string> {
  return exec('git', ['rev-list', '--max-parents=0', 'HEAD']).pipe(
    map((output) => output.trim())
  );
}

export function createTag({
  dryRun,
  version,
  tagPrefix,
  commitMessage,
}: {
  dryRun: boolean;
  version: string;
  tagPrefix: string;
  commitMessage: string;
}): Observable<string> {
  if (dryRun) {
    return EMPTY;
  }

  const tag = formatTag({ tagPrefix, version });
  return exec('git', ['tag', '-a', tag, '-m', commitMessage]).pipe(
    map(() => tag),
    logStep({ step: 'tag_success', message: `Created tag "${tag}"` })
  );
}

export function commit({
  dryRun,
  noVerify,
  commitMessage,
}: {
  dryRun: boolean;
  noVerify: boolean;
  commitMessage: string;
}): Observable<void> {
  return exec('git', [
    'commit',
    ...(dryRun ? ['--dry-run'] : []),
    ...(noVerify ? ['--no-verify'] : []),
    '-m',
    commitMessage,
  ]).pipe(
    map(() => undefined),
    logStep({
      step: 'commit_success',
      message: `Committed "${commitMessage}"`,
    })
  );
}
