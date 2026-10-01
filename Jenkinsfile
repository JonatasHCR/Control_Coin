// Control_Coin delivery pipeline — see docs/architecture/ARCH03.
//
// The agent needs a Docker socket: the integration tests run against a real
// PostgreSQL (ARCH02 — the database is never mocked), and the build produces
// three images.

pipeline {
  agent { label 'docker' }

  options {
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '30'))
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds(abortPrevious: true)
  }

  environment {
    REGISTRY     = 'registry.internal/control-coin'
    TAG          = "${env.GIT_COMMIT.take(12)}"
    DATABASE_URL = 'postgresql://control_coin:control_coin@localhost:5432/control_coin?schema=public'
  }

  stages {

    stage('Install') {
      steps {
        sh 'node --version && npm --version'
        sh 'npm ci'
      }
    }

    stage('Verify') {
      parallel {

        stage('Typecheck') {
          steps { sh 'npx turbo typecheck' }
        }

        stage('Unit') {
          steps { sh 'npx turbo test:unit' }
        }

        stage('Integration') {
          // A real database. The deferred BR12 trigger, the BR07 invoice rule
          // and the BR09 function check cannot be tested against a mock.
          steps {
            sh '''
              docker rm -f cc-ci-pg || true
              docker run -d --name cc-ci-pg \
                -e POSTGRES_USER=control_coin \
                -e POSTGRES_PASSWORD=control_coin \
                -e POSTGRES_DB=control_coin \
                -p 5432:5432 postgres:16-alpine

              for i in $(seq 1 40); do
                docker exec cc-ci-pg pg_isready -U control_coin && break
                sleep 1
              done

              npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
              npm run test:integration --workspace @cc/api
            '''
          }
          post {
            always { sh 'docker rm -f cc-ci-pg || true' }
          }
        }

        stage('Rule coverage') {
          // Every business rule must have a test named after it (ARCH02).
          steps { sh 'node scripts/assert-every-rule-tested.mjs' }
        }
      }
    }

    stage('Build images') {
      steps {
        sh """
          docker build -f apps/api/Dockerfile         -t ${REGISTRY}/api:${TAG}     .
          docker build -f apps/api/Dockerfile.migrate -t ${REGISTRY}/migrate:${TAG} .
          docker build -f apps/web/Dockerfile         -t ${REGISTRY}/web:${TAG}     .
        """
      }
    }

    stage('Push') {
      when { branch 'main' }
      steps {
        withCredentials([usernamePassword(
          credentialsId: 'registry', usernameVariable: 'REG_USER', passwordVariable: 'REG_PASS')]) {
          // Never echo the password: Jenkins keeps this log for 30 builds.
          sh 'echo "$REG_PASS" | docker login $REGISTRY -u "$REG_USER" --password-stdin'
          sh """
            docker push ${REGISTRY}/api:${TAG}
            docker push ${REGISTRY}/migrate:${TAG}
            docker push ${REGISTRY}/web:${TAG}
          """
        }
      }
    }

    stage('Staging') {
      when { branch 'main' }
      steps {
        // Back up, migrate, then roll out — in that order, always (ARCH07).
        sh "./infra/deploy.sh staging ${TAG}"
        sh 'curl -fsS https://staging.control-coin.internal/health/ready'
      }
    }

    stage('Approve production') {
      when { branch 'main' }
      steps {
        timeout(time: 24, unit: 'HOURS') {
          input message: "Deploy ${TAG} to production?", ok: 'Deploy'
        }
      }
    }

    stage('Production') {
      when { branch 'main' }
      steps {
        // The exact digest verified on staging — images are built once and
        // promoted, never rebuilt per environment (ARCH03).
        sh "./infra/deploy.sh production ${TAG}"
        sh 'curl -fsS https://control-coin.app/health/ready'
      }
    }
  }

  post {
    always {
      junit allowEmptyResults: true, testResults: 'reports/*.xml'
      sh 'docker system prune -f --filter until=24h || true'
    }
    failure {
      echo "Build ${env.BUILD_NUMBER} failed: ${env.BUILD_URL}"
    }
  }
}
